# MindAR FBX Animation Demo

A web-based AR application that displays animated FBX models using MindAR.js and Three.js.

## Setup Instructions

### 1. Target Image

For the `targets` folder, you need to:

1. Choose a high-contrast image to use as your AR marker
2. Convert it to a MindAR target file using the MindAR Image Compiler:
   - Go to: https://hiukim.github.io/mind-ar-js-doc/tools/compile
   - Upload your image
   - Download the compiled `.mind` file
   - Place it in the `targets` folder as `targets.mind`

### 2. FBX Model

For the `models` folder:

1. Place your FBX model file in the `models` folder
2. Name it `model.fbx` or update the path in `js/main.js`
3. Make sure your FBX file includes animations if you want to display them

### 3. Running the Project

- Use a local server to run the project (due to CORS restrictions)
- Open the application on a mobile device with camera access
- Point the camera at your target image to see the 3D model

## Customization

- Adjust model scale, position, and rotation in `js/main.js`
- Modify the animation playback in the FBX loader callback
- Change the AR settings in the MindAR initialization

## Browser Compatibility

This project works best on:
- Chrome for Android
- Safari for iOS (iOS 13+)