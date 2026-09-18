# The conversion service as its own container — the deployment the design spec
# recommends for servers (§7.1): the Switchboard image stays alpine, this one is
# glibc (docling.rs publishes no musl build) and carries every OCR rung.
#
#   docker build -f scripts/docling-serve/Dockerfile -t vault-convert .
#   docker run -p 5011:5011 -v vault-models:/models -e DOCLING_RS_HOME=/models vault-convert
#   # once, into the volume:  docker run --rm -v vault-models:/models -e DOCLING_RS_HOME=/models vault-convert node scripts/docling-serve/fetch-models.mjs
#
# Then point the Switchboard at it: CONVERT_SERVICE_URL=http://<host>:5011
FROM node:24-slim

# Rung 2 (Tesseract via ocrmypdf) and the PDF repair tools. Poppler comes with
# ocrmypdf; add tesseract-ocr-<lang> packages for more languages.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       ocrmypdf tesseract-ocr tesseract-ocr-eng ghostscript qpdf ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json bun.lock* ./
# The service needs only its own runtime deps; `npm` is what the base image has.
RUN npm install --omit=dev --ignore-scripts docling.rs pdfjs-dist \
  && npm rebuild docling.rs
COPY scripts/docling-serve ./scripts/docling-serve

ENV CONVERT_SERVICE_HOST=0.0.0.0 \
    CONVERT_SERVICE_PORT=5011 \
    CONVERT_OCR_JOBS=4 \
    CONVERT_AUTO_OCR_SECONDS=60
EXPOSE 5011
# `nice` so the service yields to whatever else shares the host.
CMD ["nice", "-n", "10", "node", "scripts/docling-serve/server.ts"]
