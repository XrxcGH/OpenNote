// Text in pictures and handwriting on macOS and Linux: what the intelligence settings say when the system's
// recognizer is missing. A Mac reads both with Apple's Vision; Linux reads both with Tesseract once it is installed.

export const platformIntel = {
  needs: {
    tesseract:
      "Tesseract isn't installed. Install the tesseract-ocr package and a language pack, such as tesseract-ocr-eng.",
    vision: "this Mac's text recognition didn't start. It needs macOS 11 or later.",
  },
  // The offers, the settings help, and the problems that name Windows there, as a Mac and Linux say them.
  macos: {
    offerOcr: "OpenNote can read the words in this image, using Apple's Vision on this Mac.",
    offerHandwriting: "OpenNote can turn this handwriting into text, using Apple's Vision on this Mac.",
    handwritingHelp: "Turns handwriting into text you can copy and search, using Apple's Vision on this Mac.",
    languageUnavailable: "Vision on this Mac can't read text in this language.",
    handwritingUnavailable: "Vision on this Mac can't read handwriting in this language.",
  },
  linux: {
    offerOcr: 'OpenNote can read the words in this image, with Tesseract on this computer.',
    offerHandwriting: 'OpenNote can turn this handwriting into text, with Tesseract on this computer.',
    handwritingHelp: 'Turns handwriting into text you can copy and search, with Tesseract on this computer.',
    languageUnavailable: 'Tesseract has no language pack installed. Install one, such as tesseract-ocr-eng.',
    handwritingUnavailable: 'Tesseract has no language pack installed. Install one, such as tesseract-ocr-eng.',
  },
} as const;
