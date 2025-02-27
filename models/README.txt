# Models Directory

Place your FBX model files in this directory.

## Required Models

For the full experience, you should have the following models:

1. `model.fbx` - Default fallback model
2. `model1.fbx` - First model (appears immediately)
3. `model2.fbx` - Second model (appears after 1 second)
4. `model3.fbx` - Third model (appears after 2 seconds)
5. `model4.fbx` - Fourth model (appears after 3 seconds)
6. `model5.fbx` - Fifth model (appears after 4 seconds)

## Testing

In test mode, the application will try to load these models but will fall back to `model.fbx` if any are missing.

## Model Requirements

- FBX format
- Animations included in the file
- Reasonable polygon count for mobile devices
- Properly scaled (or adjust the scale in the code) 