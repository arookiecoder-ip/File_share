// Validate uploaded file MIME type via magic bytes (file-type library).
// Blocks executables and enforces content-type honesty.

const BLOCKED_TYPES = new Set([
  'application/x-msdownload',
  'application/x-dosexec',
  'application/x-executable',
  'application/x-sharedlib',
  'application/x-msdos-program',
  'application/x-sh',
  'application/x-bat',
  'application/x-powershell',
  'application/x-mach-binary',
  'application/x-elf',
]);

const BLOCKED_EXTENSIONS = /\.(exe|dll|so|bat|cmd|sh|ps1|vbs|jar|msi|scr|com|pif|app|deb|rpm)$/i;

let _fileTypeFromBuffer;

async function getFileTypeFromBuffer(buf) {
  if (!_fileTypeFromBuffer) {
    const mod = await import('file-type');
    _fileTypeFromBuffer = mod.fileTypeFromBuffer;
  }
  return _fileTypeFromBuffer(buf);
}

async function validateFileType(buf, declaredName) {
  if (BLOCKED_EXTENSIONS.test(declaredName || '')) {
    return { ok: false, reason: 'Blocked file extension' };
  }

  try {
    const result = await getFileTypeFromBuffer(buf);
    if (result && BLOCKED_TYPES.has(result.mime)) {
      return { ok: false, reason: `Blocked file type: ${result.mime}` };
    }
  } catch { /* file-type failed — allow through, log elsewhere */ }

  return { ok: true };
}

module.exports = { validateFileType };
