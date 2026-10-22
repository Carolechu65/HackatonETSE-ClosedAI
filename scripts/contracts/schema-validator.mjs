import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';

/**
 * Validador mínimo de JSON Schema 2020-12 para contratos de alarmaT.
 *
 * Cubre únicamente las palabras clave que usan nuestros esquemas, para no añadir
 * una dependencia antes de revisarla (ver CONTRIBUTING.md). Si un esquema usa una
 * palabra clave nueva, este archivo debe ampliarse y el contrato queda verificado
 * por `npm run test:contracts`.
 */

const SUPPORTED_KEYWORDS = new Set([
  '$schema',
  '$id',
  '$defs',
  '$ref',
  '$comment',
  'title',
  'description',
  'type',
  'const',
  'enum',
  'required',
  'properties',
  'additionalProperties',
  'items',
  'minItems',
  'maxItems',
  'uniqueItems',
  'minLength',
  'maxLength',
  'pattern',
  'minimum',
  'maximum',
  'allOf',
  'anyOf',
  'oneOf',
  'not',
  'if',
  'then',
  'else',
]);

export async function createContractValidator(rootDir) {
  const schemas = new Map();

  async function loadSchema(relativePath) {
    if (schemas.has(relativePath)) return schemas.get(relativePath);
    const raw = await readFile(path.join(rootDir, relativePath), 'utf8');
    const schema = JSON.parse(raw);
    schemas.set(relativePath, schema);
    return schema;
  }

  function pointerTarget(rootSchema, pointer) {
    if (!pointer || pointer === '/') return rootSchema;
    return pointer
      .split('/')
      .slice(1)
      .reduce((node, token) => node?.[token.replace(/~1/g, '/').replace(/~0/g, '~')], rootSchema);
  }

  async function resolveRef(ref, currentFile) {
    const [filePart, pointer = ''] = ref.split('#');
    const targetFile = filePart === '' ? currentFile : path.posix.normalize(path.posix.join(path.posix.dirname(currentFile), filePart));
    const targetSchema = await loadSchema(targetFile);
    const target = pointerTarget(targetSchema, pointer);
    if (!target) throw new Error(`No se pudo resolver $ref ${ref} desde ${currentFile}`);
    return { schema: target, file: targetFile };
  }

  function collectUnknownKeywords(schema, where, unknown) {
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return;
    for (const [keyword, value] of Object.entries(schema)) {
      if (!SUPPORTED_KEYWORDS.has(keyword)) unknown.push(`${where}: palabra clave no soportada "${keyword}"`);
      if (keyword === 'properties' || keyword === '$defs') {
        for (const [name, child] of Object.entries(value)) {
          collectUnknownKeywords(child, `${where}/${keyword}/${name}`, unknown);
        }
      }
      if (keyword === 'items' || keyword === 'not' || keyword === 'if' || keyword === 'then' || keyword === 'else') {
        collectUnknownKeywords(value, `${where}/${keyword}`, unknown);
      }
      if (keyword === 'allOf' || keyword === 'anyOf' || keyword === 'oneOf') {
        value.forEach((child, index) => collectUnknownKeywords(child, `${where}/${keyword}/${index}`, unknown));
      }
      if (keyword === 'additionalProperties' && typeof value === 'object') {
        collectUnknownKeywords(value, `${where}/additionalProperties`, unknown);
      }
    }
  }

  async function validateSchemaKeywords(schema, value, file, pointer, errors) {
    if (!schema || typeof schema !== 'object') return;

    if (schema.$ref) {
      const resolved = await resolveRef(schema.$ref, file);
      await validateSchemaKeywords(resolved.schema, value, resolved.file, pointer, errors);
    }

    if ('const' in schema && !isDeepStrictEqual(value, schema.const)) {
      errors.push(`${pointer}: debe ser ${JSON.stringify(schema.const)}`);
    }

    if (schema.enum && !schema.enum.some((option) => isDeepStrictEqual(value, option))) {
      errors.push(`${pointer}: valor ${JSON.stringify(value)} fuera de ${JSON.stringify(schema.enum)}`);
    }

    if (schema.type && !matchesType(schema.type, value)) {
      errors.push(`${pointer}: se esperaba ${schema.type} y llegó ${describeType(value)}`);
      return;
    }

    if (typeof value === 'string') {
      if (schema.minLength !== undefined && value.length < schema.minLength) {
        errors.push(`${pointer}: longitud mínima ${schema.minLength}`);
      }
      if (schema.maxLength !== undefined && value.length > schema.maxLength) {
        errors.push(`${pointer}: longitud máxima ${schema.maxLength}`);
      }
      if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
        errors.push(`${pointer}: no cumple el patrón ${schema.pattern}`);
      }
    }

    if (typeof value === 'number') {
      if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${pointer}: mínimo ${schema.minimum}`);
      if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${pointer}: máximo ${schema.maximum}`);
    }

    if (Array.isArray(value)) {
      if (schema.minItems !== undefined && value.length < schema.minItems) {
        errors.push(`${pointer}: mínimo ${schema.minItems} elementos`);
      }
      if (schema.maxItems !== undefined && value.length > schema.maxItems) {
        errors.push(`${pointer}: máximo ${schema.maxItems} elementos`);
      }
      if (schema.uniqueItems === true) {
        for (let i = 0; i < value.length; i += 1) {
          for (let j = i + 1; j < value.length; j += 1) {
            if (isDeepStrictEqual(value[i], value[j])) errors.push(`${pointer}/${i}: elemento duplicado`);
          }
        }
      }
      if (schema.items) {
        await Promise.all(value.map((item, index) => validateSchemaKeywords(schema.items, item, file, `${pointer}/${index}`, errors)));
      }
    }

    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      for (const required of schema.required ?? []) {
        if (!(required in value)) errors.push(`${pointer}: falta el campo obligatorio "${required}"`);
      }
      const properties = schema.properties ?? {};
      const extraKeys = Object.keys(value).filter((key) => !(key in properties));
      if (schema.additionalProperties === false && extraKeys.length > 0) {
        errors.push(`${pointer}: campos no permitidos ${JSON.stringify(extraKeys)}`);
      }
      if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
        for (const key of extraKeys) {
          await validateSchemaKeywords(schema.additionalProperties, value[key], file, `${pointer}/${key}`, errors);
        }
      }
      for (const [key, childSchema] of Object.entries(properties)) {
        if (key in value) await validateSchemaKeywords(childSchema, value[key], file, `${pointer}/${key}`, errors);
      }
    }

    for (const childSchema of schema.allOf ?? []) {
      await validateSchemaKeywords(childSchema, value, file, pointer, errors);
    }

    if (schema.anyOf) {
      let matched = false;
      for (const childSchema of schema.anyOf) {
        const childErrors = [];
        await validateSchemaKeywords(childSchema, value, file, pointer, childErrors);
        if (childErrors.length === 0) matched = true;
      }
      if (!matched) errors.push(`${pointer}: no cumple ninguna rama anyOf`);
    }

    if (schema.oneOf) {
      let matches = 0;
      for (const childSchema of schema.oneOf) {
        const childErrors = [];
        await validateSchemaKeywords(childSchema, value, file, pointer, childErrors);
        if (childErrors.length === 0) matches += 1;
      }
      if (matches !== 1) errors.push(`${pointer}: debe cumplir exactamente una rama oneOf (cumple ${matches})`);
    }

    if (schema.not) {
      const childErrors = [];
      await validateSchemaKeywords(schema.not, value, file, pointer, childErrors);
      if (childErrors.length === 0) errors.push(`${pointer}: cumple un esquema prohibido (not)`);
    }

    if (schema.if) {
      const conditionErrors = [];
      await validateSchemaKeywords(schema.if, value, file, pointer, conditionErrors);
      const branch = conditionErrors.length === 0 ? schema.then : schema.else;
      if (branch) await validateSchemaKeywords(branch, value, file, pointer, errors);
    }
  }

  async function validate(value, schemaPath) {
    const schema = await loadSchema(schemaPath);
    const errors = [];
    await validateSchemaKeywords(schema, value, schemaPath, '$', errors);
    return errors;
  }

  async function auditSchemaKeywords(schemaPath, errors) {
    const schema = await loadSchema(schemaPath);
    collectUnknownKeywords(schema, schemaPath, errors);
    return schema;
  }

  return { validate, auditSchemaKeywords, loadSchema };
}

function matchesType(type, value) {
  switch (type) {
    case 'object':
      return value !== null && typeof value === 'object' && !Array.isArray(value);
    case 'array':
      return Array.isArray(value);
    case 'integer':
      return Number.isInteger(value);
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    default:
      return typeof value === type;
  }
}

function describeType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}
