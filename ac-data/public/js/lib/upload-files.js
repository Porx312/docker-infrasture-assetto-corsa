/**
 * @param {File} file
 */
export function uploadRelativePath(file) {
  return file.webkitRelativePath || file.name;
}

/**
 * @param {FileSystemDirectoryReader} reader
 * @returns {Promise<FileSystemEntry[]>}
 */
function readAllDirectoryEntries(reader) {
  return new Promise((resolve) => {
    /** @type {FileSystemEntry[]} */
    const entries = [];

    const readBatch = () => {
      reader.readEntries((batch) => {
        if (!batch.length) {
          resolve(entries);
          return;
        }
        entries.push(...batch);
        readBatch();
      });
    };

    readBatch();
  });
}

/**
 * @param {FileSystemEntry} entry
 * @param {string} prefix
 * @param {File[]} files
 */
async function walkEntry(entry, prefix, files) {
  if (entry.isFile) {
    const file = await new Promise((resolve) => {
      entry.file((f) => resolve(f));
    });
    if (!file) return;

    const relPath = prefix ? `${prefix}/${file.name}` : file.name;
    files.push(new File([file], relPath, { type: file.type, lastModified: file.lastModified }));
    return;
  }

  if (!entry.isDirectory) return;

  const dirPrefix = prefix ? `${prefix}/${entry.name}` : entry.name;
  const children = await readAllDirectoryEntries(entry.createReader());
  for (const child of children) {
    await walkEntry(child, dirPrefix, files);
  }
}

/**
 * @param {DataTransfer} dataTransfer
 * @returns {Promise<File[]>}
 */
export async function filesFromDataTransfer(dataTransfer) {
  const items = dataTransfer.items;
  if (!items?.length) {
    return Array.from(dataTransfer.files ?? []);
  }

  /** @type {File[]} */
  const files = [];

  for (const item of items) {
    if (item.kind !== 'file') continue;

    const entry = item.webkitGetAsEntry?.();
    if (entry) {
      await walkEntry(entry, '', files);
      continue;
    }

    const file = item.getAsFile();
    if (file) files.push(file);
  }

  return files.length ? files : Array.from(dataTransfer.files ?? []);
}

/**
 * @param {FileList | File[]} fileList
 * @returns {File[]}
 */
export function normalizeUploadFiles(fileList) {
  return Array.from(fileList ?? []).map((file) => {
    const relPath = uploadRelativePath(file);
    if (relPath === file.name) return file;
    return new File([file], relPath, { type: file.type, lastModified: file.lastModified });
  });
}
