export class MermaidIncludeError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "MermaidIncludeError";
    this.details = details;
  }
}
