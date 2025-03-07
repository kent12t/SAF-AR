# SAFRA AR Web Experience

A web-based Augmented Reality (AR) application that displays animated 3D models when a target image is detected. Built with MindAR.js and Three.js.

## Overview

This application allows users to view 3D models in augmented reality by pointing their device camera at a specific target image. The models appear sequentially with spotlight effects, creating an engaging AR experience.

## Features

- Image-based AR tracking using MindAR
- Support for both FBX and GLTF/GLB 3D model formats
- Sequential animation of multiple models
- Spotlight effects for visual enhancement
- Responsive design that works across devices
- Automatic handling of camera permissions
- Fallback test mode for development without AR

## Setup Instructions

### 1. Target Image

For the AR experience to work, you need a target image:

1. Choose a high-contrast image to use as your AR marker
2. Convert it to a MindAR target file using the MindAR Image Compiler:
   - Go to: https://hiukim.github.io/mind-ar-js-doc/tools/compile
   - Upload your image
   - Download the compiled `.mind` file
   - Place it in the `targets` folder as `targets.mind`

### 2. 3D Models

The application is configured to work with specific models:

1. Place your 3D model files in the `models` folder
2. The application is configured to load the following models:
   - `army-ar.glb` - Army model
   - `civilian.fbx` - Civilian model
   - `rsaf.fbx` - RSAF model
   - `dis.glb` - DIS model
   - `dis-ball.fbx` - DIS Ball model
   - `navy.fbx` - Navy model

### 3. Running the Project

- Use a local server to run the project (due to CORS restrictions)
- Open the application on a mobile device with camera access
- Point the camera at your target image to see the 3D models

## Usage

1. Open the application in a mobile browser
2. Click the "Start" button to begin the AR experience
3. Allow camera permissions when prompted
4. Point your camera at the target image
5. Watch as the 3D models appear sequentially
6. Click "Stop" to end the AR experience

## Technical Details

- The application uses MindAR for image tracking
- Three.js is used for 3D rendering
- Models are loaded with FBXLoader or GLTFLoader depending on the file format
- Animations are controlled via Three.js AnimationMixer
- The anchor position and scale are optimized for the target image

## Browser Compatibility

This project works best on:
- Chrome for Android
- Safari for iOS (iOS 13+)
- Modern desktop browsers with webcam access

## Development

To modify the application:

- Edit model configurations in the `getModelConfigs()` function in `js/main.js`
- Adjust the anchor position and scale in the AR initialization section
- Modify animation sequences and timing as needed

## License

This project is proprietary and confidential. All rights reserved.