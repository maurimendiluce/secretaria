// Exportar una nota a Word (.docx) o a LibreOffice (.odt), sin librerías ni servidor:
// los dos formatos son un .zip con archivos XML adentro, y acá se arma ese zip a mano.

import { descargarArchivo } from "./core.js";

var codificar = new TextEncoder();

var TABLA_CRC = (function () {
  var t = [];
  for (var n = 0; n < 256; n++) {
    var c = n;
    for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  var c = 0xffffffff;
  for (var i = 0; i < bytes.length; i++) c = TABLA_CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// Arma un .zip sin comprimir. `archivos` = [[nombre, texto], ...] (el orden se respeta).
function zip(archivos) {
  var locales = [],
    centrales = [],
    offset = 0;
  archivos.forEach(function (a) {
    var nombre = codificar.encode(a[0]),
      datos = codificar.encode(a[1]),
      crc = crc32(datos);

    var h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); // firma
    h.setUint16(4, 20, true); // versión
    h.setUint16(6, 0x0800, true); // nombres en UTF-8
    h.setUint16(8, 0, true); // sin compresión
    h.setUint16(12, 33, true); // fecha: 1/1/1980
    h.setUint32(14, crc, true);
    h.setUint32(18, datos.length, true);
    h.setUint32(22, datos.length, true);
    h.setUint16(26, nombre.length, true);
    locales.push(new Uint8Array(h.buffer), nombre, datos);

    var c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true);
    c.setUint16(6, 20, true);
    c.setUint16(8, 0x0800, true);
    c.setUint16(14, 33, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, datos.length, true);
    c.setUint32(24, datos.length, true);
    c.setUint16(28, nombre.length, true);
    c.setUint32(42, offset, true);
    centrales.push(new Uint8Array(c.buffer), nombre);

    offset += 30 + nombre.length + datos.length;
  });

  var tamCentral = centrales.reduce(function (s, p) {
    return s + p.length;
  }, 0);
  var fin = new DataView(new ArrayBuffer(22));
  fin.setUint32(0, 0x06054b50, true);
  fin.setUint16(8, archivos.length, true);
  fin.setUint16(10, archivos.length, true);
  fin.setUint32(12, tamCentral, true);
  fin.setUint32(16, offset, true);

  var partes = locales.concat(centrales, [new Uint8Array(fin.buffer)]);
  var total = partes.reduce(function (s, p) {
    return s + p.length;
  }, 0);
  var salida = new Uint8Array(total),
    pos = 0;
  partes.forEach(function (p) {
    salida.set(p, pos);
    pos += p.length;
  });
  return salida;
}

// Texto seguro para XML: se sacan los caracteres de control que el formato no admite.
function xml(s) {
  return String(s == null ? "" : s)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function lineas(texto) {
  return String(texto == null ? "" : texto).replace(/\r\n?/g, "\n").split("\n");
}

// ---------- Word (.docx) ----------
function parrafoDocx(linea, propiedades) {
  if (!linea) return "<w:p/>";
  var partes = linea.split("\t").map(function (t) {
    return t ? '<w:t xml:space="preserve">' + xml(t) + "</w:t>" : "";
  });
  return "<w:p><w:r>" + (propiedades || "") + partes.join("<w:tab/>") + "</w:r></w:p>";
}

export function crearDocx(titulo, texto) {
  var cuerpo = parrafoDocx(titulo || "Nota", '<w:rPr><w:b/><w:sz w:val="36"/></w:rPr>') + "<w:p/>";
  cuerpo += lineas(texto)
    .map(function (l) {
      return parrafoDocx(l);
    })
    .join("");

  var NS_W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  var CAB = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  return zip([
    [
      "[Content_Types].xml",
      CAB +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
        "</Types>",
    ],
    [
      "_rels/.rels",
      CAB +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
        "</Relationships>",
    ],
    [
      "word/_rels/document.xml.rels",
      CAB +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
        "</Relationships>",
    ],
    [
      "word/styles.xml",
      CAB +
        "<w:styles " + NS_W + ">" +
        '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:lang w:val="es-AR"/></w:rPr></w:rPrDefault>' +
        '<w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
        '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
        "</w:styles>",
    ],
    [
      "word/document.xml",
      CAB +
        "<w:document " + NS_W + "><w:body>" + cuerpo +
        '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>' +
        "</w:body></w:document>",
    ],
  ]);
}

// ---------- LibreOffice (.odt) ----------
function parrafoOdt(linea, estilo) {
  var t = xml(linea)
    .replace(/\t/g, "<text:tab/>")
    .replace(/ {2,}/g, function (m) {
      return ' <text:s text:c="' + (m.length - 1) + '"/>';
    });
  return "<text:p" + (estilo ? ' text:style-name="' + estilo + '"' : "") + ">" + t + "</text:p>";
}

export function crearOdt(titulo, texto) {
  var cuerpo = parrafoOdt(titulo || "Nota", "Titulo") + "<text:p/>";
  cuerpo += lineas(texto)
    .map(function (l) {
      return parrafoOdt(l);
    })
    .join("");

  return zip([
    ["mimetype", "application/vnd.oasis.opendocument.text"], // tiene que ser el primero y sin comprimir
    [
      "META-INF/manifest.xml",
      '<?xml version="1.0" encoding="UTF-8"?>' +
        '<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2">' +
        '<manifest:file-entry manifest:full-path="/" manifest:version="1.2" manifest:media-type="application/vnd.oasis.opendocument.text"/>' +
        '<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>' +
        "</manifest:manifest>",
    ],
    [
      "content.xml",
      '<?xml version="1.0" encoding="UTF-8"?>' +
        '<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" office:version="1.2">' +
        '<office:automatic-styles><style:style style:name="Titulo" style:family="paragraph"><style:text-properties fo:font-weight="bold" fo:font-size="18pt"/></style:style></office:automatic-styles>' +
        "<office:body><office:text>" + cuerpo + "</office:text></office:body></office:document-content>",
    ],
  ]);
}

export function descargarDocx(base, titulo, texto) {
  descargarArchivo(
    base + ".docx",
    crearDocx(titulo, texto),
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  );
}

export function descargarOdt(base, titulo, texto) {
  descargarArchivo(base + ".odt", crearOdt(titulo, texto), "application/vnd.oasis.opendocument.text");
}
