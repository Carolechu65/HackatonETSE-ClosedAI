# Derived image is exclusive to AlarmaT; it does not change the source container.
ARG OCR_BASE=alarmat-ocr-base:3f8c4e369c0d
FROM ${OCR_BASE}
USER root
RUN apt-get update \
 && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-spa tesseract-ocr-eng \
 && rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*
USER 10001:10001
