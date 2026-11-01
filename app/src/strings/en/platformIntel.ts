// Text in pictures and handwriting on macOS and Linux: what the intelligence settings say when the system's
// recognizer is missing. A Mac reads both with Apple's Vision; Linux reads both with Tesseract once it is installed.

export const platformIntel = {
  needs: {
    tesseract:
      "Tesseract isn't installed. Install the tesseract-ocr package and a language pack, such as tesseract-ocr-eng.",
    vision: "this Mac's text recognition didn't start. It needs macOS 11 or later.",
  },
} as const;
