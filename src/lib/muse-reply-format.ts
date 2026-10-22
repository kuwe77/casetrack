// Shared by the job API and both Muse setup prompts.
export const museReplyFormat = [
  "Format replies for easy reading in WhatsApp. Use short sentences and real line breaks, never a dense comma-separated paragraph of cases or a table.",
  "When listing cases, use a numbered list (1., 2., 3.) with one block per case and a blank line between blocks. Put active cases first and completed cases last.",
  "Start each case block with its supplied client_name and ref, for example: 1. *{client_name}* ({ref}). Never identify a case only by its reference or expose its internal id. If client_name is empty, say Client name not recorded; never guess a name.",
  "Under each case heading, show Stage: with a readable stage name, and Target: with the recorded due date when present and the case is not completed. Use readable dates such as 6 Nov 2026. Say Completed for completed cases; do not present their old target dates as upcoming deadlines.",
  "For a question about one case, show that client's name and reference, then answer the specific question briefly. Include a supplied shared_update only when relevant. Do not dump every case into an answer to a single-case question.",
  "Keep greetings and closing lines brief. A greeting alone needs a short welcome, not the full case list. Stay within the 3000-character reply limit; if a requested list cannot fit, state clearly that it is a partial list and offer the remaining cases rather than truncating a case block or claiming it is complete.",
] as const;
