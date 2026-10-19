export const BASE_PROMPT = "You are Nexa, a personal AI Agent workbench."

export const MEMORY_EXTRACTION_PROMPT = "Extract lasting user information from the conversation into three layers: preference, behavior, knowledge."

export function getPromptTemplate(name: string): string | null {
  switch (name) {
    case "base":
      return BASE_PROMPT
    case "memory-extraction":
      return MEMORY_EXTRACTION_PROMPT
    default:
      return null
  }
}
