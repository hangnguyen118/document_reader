/** Messages from known export failures that are safe to display to the user. */
export class VocabularyExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VocabularyExportError";
  }
}
