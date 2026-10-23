"""Conservative, local receipt proposals. No inference of absent monetary data."""
import re
from datetime import datetime
from decimal import Decimal, InvalidOperation

AMOUNT = r'[-+]?\d(?:[\d., ]*\d)?[.,]\d{2}'
CURRENCY = r'(?:EUR|USD|GBP|€|£|\$)'
TOTAL_LABEL = r'(?:TOTAL(?:\s+(?:A\s+PAGAR|COMPRA|VENTA))?|IMPORTE\s+TOTAL|GRAND\s+TOTAL|AMOUNT\s+DUE)'
TOTAL = re.compile(r'^\s*'+TOTAL_LABEL+r'\s*[:=]?\s*(?:'+CURRENCY+r'\s*)?('+AMOUNT+r')(?:\s*'+CURRENCY+r')?\s*$', re.I)
TOTAL_ONLY = re.compile(r'^\s*'+TOTAL_LABEL+r'\s*[:=]?\s*(?:'+CURRENCY+r')?\s*$', re.I)
AMOUNT_ONLY = re.compile(r'^\s*(?:'+CURRENCY+r'\s*)?('+AMOUNT+r')(?:\s*'+CURRENCY+r')?\s*$', re.I)


def amount(value):
    value = value.strip().replace(' ', '')
    if value.startswith(('-', '+')):
        return None
    if re.fullmatch(r'\d+[.,]\d{2}', value):
        normalized = value.replace(',', '.')
    elif re.fullmatch(r'\d{1,3}(?:\.\d{3})+,\d{2}', value):
        normalized = value.replace('.', '').replace(',', '.')
    elif re.fullmatch(r'\d{1,3}(?:,\d{3})+\.\d{2}', value):
        normalized = value.replace(',', '')
    else:
        return None
    try:
        value = Decimal(normalized)
        return format(value, '.2f') if Decimal('0') < value <= Decimal('10000000') else None
    except InvalidOperation:
        return None


def parse_receipt_text(text):
    text = text[:20000]
    lines = [re.sub(r'\s+', ' ', line).strip() for line in text.splitlines() if line.strip()]
    fields = {name: {'value': None, 'verification': 'unverified', 'evidence': ''}
              for name in ('merchant', 'purchased_on', 'total', 'currency', 'tax_amount', 'receipt_number')}
    warnings = [{'code': 'local_ocr_review_required'}]

    def propose(name, value, evidence):
        fields[name].update(value=value, evidence=evidence[:500])

    # First plausible heading is a merchant proposal, never a verified identity.
    for line in lines[:6]:
        if (4 <= len(line) <= 100 and sum(c.isalpha() for c in line) >= 4
                and not re.search(r'\b(?:fecha|date|ticket|factura|recibo|total|compra|venta|cif|nif|tel|http|www|gracias)\b|\d{2}[/.-]\d{2}|@', line, re.I)):
            propose('merchant', line, line)
            break

    dates = []
    for line in lines:
        for match in re.finditer(r'(?<!\d)(?:\d{2}[/.-]\d{2}[/.-]\d{4}|\d{4}-\d{2}-\d{2})(?!\d)', line):
            raw = match[0]
            fmt = '%Y-%m-%d' if raw[4:5] == '-' else '%d/%m/%Y'
            normalized = raw if fmt == '%Y-%m-%d' else raw.replace('.', '/').replace('-', '/')
            try:
                date = datetime.strptime(normalized, fmt).date().isoformat()
                dates.append((date, line))
            except ValueError:
                warnings.append({'code': 'invalid_date'})
    if len({d[0] for d in dates}) == 1:
        propose('purchased_on', dates[0][0], dates[0][1])
    elif dates:
        warnings.append({'code': 'ambiguous_date'})

    totals = []
    for index, line in enumerate(lines):
        match = TOTAL.fullmatch(line)
        evidence = line
        if not match and TOTAL_ONLY.fullmatch(line) and index + 1 < len(lines):
            match = AMOUNT_ONLY.fullmatch(lines[index+1])
            evidence += '\n' + lines[index+1]
        if match:
            value = amount(match[1])
            if value is not None:
                totals.append((value, evidence))
    if len({t[0] for t in totals}) == 1:
        propose('total', totals[0][0], totals[0][1])
    elif totals:
        warnings.append({'code': 'ambiguous_total'})
    else:
        warnings.append({'code': 'total_not_found'})

    currencies = set()
    for code, pattern in [('EUR', r'\bEUR\b|€'), ('USD', r'\bUSD\b'), ('GBP', r'\bGBP\b|£')] + [(code, r'\b'+code+r'\b') for code in ['CAD', 'AUD', 'CHF', 'JPY', 'CNY', 'MXN', 'ARS', 'COP', 'CLP', 'PEN', 'BRL', 'INR']]:
        if re.search(pattern, text, re.I):
            currencies.add(code)
    # A bare dollar symbol is not enough to infer USD (could be CAD/AUD/etc.).
    if '$' in text and not re.search(r'\bUSD\b', text, re.I):
        currencies.add('UNKNOWN')
    if len(currencies) == 1 and 'UNKNOWN' not in currencies:
        propose('currency', next(iter(currencies)), next(iter(currencies)))
    else:
        if currencies:
            propose('currency', 'UNKNOWN', 'Ambiguous or unspecified foreign currency')
        warnings.append({'code': 'currency_needs_review'})

    for line in lines:
        match = re.fullmatch(r'(?:TICKET|N[ºo°.]?\s*TICKET|FACTURA(?:\s+SIMPLIFICADA)?)\s*[:#-]?\s*([A-Z0-9][A-Z0-9/-]{1,39})', line, re.I)
        if match:
            propose('receipt_number', match[1], line)
            break
    # Tax may be a table/rate rather than an amount: only an explicit quota.
    taxes = []
    for line in lines:
        match = re.fullmatch(r'(?:CUOTA\s+IVA|TOTAL\s+IVA|TAX(?:\s+AMOUNT)?)\s*[:=]?\s*('+AMOUNT+r')(?:\s*'+CURRENCY+r')?', line, re.I)
        if match and (value := amount(match[1])):
            taxes.append((value, line))
    if len({t[0] for t in taxes}) == 1:
        propose('tax_amount', taxes[0][0], taxes[0][1])
    if not any(fields[name]['value'] for name in ('purchased_on', 'total')):
        warnings.append({'code': 'insufficient_receipt_fields'})
    return fields, warnings
