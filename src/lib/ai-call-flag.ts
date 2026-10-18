// Lets other screens (e.g. Calls) open ASF AI and start a voice call as soon as the conversation is ready.
let requestedAt = 0;
export function requestAiCall() { requestedAt = Date.now(); }
export function takeAiCall() { return Date.now() - requestedAt < 6000; }
export function clearAiCall() { requestedAt = 0; }
