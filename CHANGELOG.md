# Changelog

All notable changes to OpenNote are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Foundation

- Set up the project structure for Windows development with Tauri 2
- Integrated TypeScript and React for the user interface
- Configured continuous integration with automated checks and tests
- Established the release workflow for signed, stable builds

### Releases

- Each release ships three Windows files: one for 64-bit PCs, one for 32-bit PCs, and one for Arm PCs
- Each release lists what OpenNote is made of, and publishes a checksum for every file
- The update notice shows the release notes for the new version
- A release is checked the way the app checks an update before anyone can download it
- Windows package manager (winget) files are made for every stable release

### Experiments

- Evaluated ink drawing performance with Surface Pen and Wacom tablets
- Tested placing text editors on a zoomable canvas alongside handwriting
- Prototyped PDF export to verify page layout fidelity
- Built audio recording support for microphone and system audio capture

[Unreleased]: https://github.com/XrxcGH/OpenNote/compare/main...main
