"""Alarmat adapter over the pinned Trace-it ingestion image. No Trace-it database access."""
import io
import base64
import os
import re
import secrets
import threading
from contextlib import asynccontextmanager
from dataclasses import replace
from datetime import datetime
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from starlette.concurrency import run_in_threadpool
from app.features.ingestion.config import Settings
from app.features.ingestion.extraction_plan import ExtractionField, ExtractionPlan
from app.features.ingestion.schemas import ExtractOptions
from app.features.ingestion.service import ExtractionService
from app.features.ingestion.documents import as_pdf, PDF_LOCK
from app.features.ingestion.ocr import vision
import pymupdf

TOKEN = os.environ['ALARMAT_OCR_TOKEN']
# Receipt separators are legitimate observations, not model repetition. Keep the
# upstream guard for all substantive text; customize only this sidecar's reader.
_transcript_warnings = vision.transcript_warnings
def receipt_transcript_warnings(text):
    substantive = '\n'.join(line for line in text.splitlines()
                            if not re.fullmatch(r'\s*[-_=.*─━]{3,}\s*', line))
    return _transcript_warnings(substantive)
vision.transcript_warnings = receipt_transcript_warnings

settings = replace(Settings(), data_dir=Path('/data'), max_file_bytes=8*1024*1024,
                   max_pages=4, workers=1, extraction_timeout=100)
engine = ExtractionService(settings)
FIELDS = [
    ExtractionField(name='merchant', type='text', description='Name of the shop or restaurant printed on the receipt', labels=['Comercio','Establecimiento','Razón social']),
    ExtractionField(name='purchased_on', type='date', description='Date of purchase printed on the receipt, not a payment deadline', labels=['Fecha','Fecha de compra','Date']),
    ExtractionField(name='total', type='number', description='Final total paid including tax, not cash tendered, change, subtotal or card number', labels=['TOTAL','TOTAL EUR','Total a pagar','Importe total','TOTAL A PAGAR']),
    ExtractionField(name='currency', type='text', description='Printed ISO currency or currency symbol', labels=['Moneda','Currency']),
    ExtractionField(name='tax_amount', type='number', description='Total tax amount only when explicitly printed', labels=['IVA','Cuota IVA','Tax']),
    ExtractionField(name='receipt_number', type='text', description='Receipt or simplified invoice number', labels=['Ticket','Nº ticket','Factura simplificada','Factura']),
]
PLAN = ExtractionPlan(process_id=0, fields=FIELDS)

@asynccontextmanager
async def lifespan(app):
    yield
    engine.close()

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)
busy = threading.Lock()

@app.get('/health')
def health():
    return {'status':'ok','engine':'trace-it','mode':settings.ocr_mode}

def preview(content):
    with PDF_LOCK, pymupdf.open(stream=as_pdf(content, settings), filetype='pdf') as document:
        page = document[0]
        scale = min(1.0, 1200 / max(page.rect.width, page.rect.height))
        for _ in range(5):
            pixels = page.get_pixmap(matrix=pymupdf.Matrix(scale, scale), alpha=False)
            image = pixels.tobytes('jpeg', jpg_quality=75)
            if len(image) <= 180000:
                return 'data:image/jpeg;base64,' + base64.b64encode(image).decode('ascii')
            scale *= .75
    return None

def date_proposal(reading):
    """Receipt timestamps include a time; preserve the observed local date."""
    source = (reading.text or '').strip()
    for pattern, fmt in ((r'(\d{2}/\d{2}/\d{4})(?:\s+\d{2}:\d{2}(?::\d{2})?)?', '%d/%m/%Y'),
                         (r'(\d{4}-\d{2}-\d{2})(?:[ T]\d{2}:\d{2}(?::\d{2})?)?', '%Y-%m-%d')):
        match = re.fullmatch(pattern, source)
        if match:
            try:
                return datetime.strptime(match[1], fmt).date().isoformat()
            except ValueError:
                return None
    return None

def extract(content, filename):
    if not busy.acquire(blocking=False):
        raise HTTPException(429, 'Reader busy; retry shortly')
    try:
        item = engine.ingest(io.BytesIO(content), filename)
        result = engine.extract_schema(item, ExtractOptions(mode=settings.ocr_mode).normalized(settings), PLAN)
    finally:
        busy.release()
    fields = {name: {'value': r.value or r.proposed_value, 'verification':r.verification,
                     'evidence':(r.text or '')[:500]} for name,r in result.fields.items()}
    date = result.fields.get('purchased_on')
    if date and not fields['purchased_on']['value']:
        proposal = date_proposal(date)
        if proposal:
            fields['purchased_on'].update(value=proposal, verification='unverified')
    if not any(fields.get(name, {}).get('value') for name in ('merchant', 'purchased_on', 'total')):
        raise HTTPException(503, 'No receipt fields could be read; retry or enter manually')
    # Preserve uncertainty. A single model's proposal is never labelled verified.
    return {'fields':fields, 'text':result.text[:20000],
            'warnings':[{'code':str(w.get('code','review'))[:80]} for w in result.warnings[:30]],
            'engine':'trace-it', 'pipelineVersion':result.pipeline_version,
            'previewDataUrl':preview(content)}

@app.post('/extract')
async def read(request: Request):
    if not secrets.compare_digest(request.headers.get('authorization',''), 'Bearer '+TOKEN):
        raise HTTPException(401)
    content=bytearray()
    async for chunk in request.stream():
        content.extend(chunk)
        if len(content)>settings.max_file_bytes: raise HTTPException(413)
    filename=request.headers.get('x-filename','ticket.jpg')
    if not filename.lower().endswith(('.jpg','.jpeg','.png','.pdf')): raise HTTPException(400)
    try:
        return await run_in_threadpool(extract,bytes(content),filename)
    except HTTPException:
        raise
    except ValueError:
        raise HTTPException(400,'Invalid document')
    except Exception:
        raise HTTPException(503,'Reading unavailable')
