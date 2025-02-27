import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MindARThree } from 'mindar-image-three';

// DOM elements
const loadingElement = document.querySelector('.loading');
const startButton = document.getElementById('startButton');
const stopButton = document.getElementById('stopButton');
const testModeToggle = document.getElementById('testModeToggle');

console.log('=== APP INITIALIZATION ===');
console.log('DOM elements initialized');

// Global variables
let mindarThree = null;
let mixer = null;
let clock = new THREE.Clock();
let scene, camera, renderer;
let testMode = true; // Default to test mode

// Set initial test mode from checkbox
testMode = testModeToggle ? testModeToggle.checked : true;
console.log('Initial test mode:', testMode);

// Listen for test mode toggle changes
if (testModeToggle) {
  testModeToggle.addEventListener('change', (event) => {
    testMode = event.target.checked;
    console.log(`Test mode ${testMode ? 'enabled' : 'disabled'}`);
  });
} else {
  console.warn('Test mode toggle element not found!');
}

// Helper functions for model fixes
// Fix material issues
function fixMaterial(material) {
  console.log('Fixing material:', material.name || 'unnamed');
  
  // Set double-sided rendering
  material.side = THREE.DoubleSide;
  
  // Fix transparency issues
  if (material.transparent) {
    console.log('Material has transparency, adjusting settings');
    material.transparent = true;
    material.opacity = 1.0;
    material.alphaTest = 0.01; // Helps with transparency sorting
    material.depthWrite = true; // Ensure transparent objects write to depth buffer
  }
  
  // Ensure textures are properly set up
  if (material.map) {
    console.log('Material has diffuse map:', material.map.name || 'unnamed');
    material.map.needsUpdate = true;
    material.map.encoding = THREE.sRGBEncoding;
  }
  
  // Ensure proper normal maps
  if (material.normalMap) {
    console.log('Material has normal map:', material.normalMap.name || 'unnamed');
    material.normalMap.needsUpdate = true;
    material.normalScale.set(1, 1); // Reset normal scale
  }
  
  // Ensure proper material settings
  material.needsUpdate = true;
  
  return material;
}

// Fix geometry issues
function fixGeometry(geometry) {
  console.log('Checking geometry for issues');
  
  // Check and fix normal vectors if needed
  if (geometry.attributes.normal) {
    console.log('Geometry has normal attributes');
    geometry.computeVertexNormals(); // Recompute normals
    geometry.attributes.normal.needsUpdate = true;
  } else {
    console.log('Computing normals for geometry without normals');
    geometry.computeVertexNormals();
  }
  
  // Make sure buffers are updated
  geometry.attributes.position.needsUpdate = true;
  
  return geometry;
}

// Model Manager for handling multiple models
const ModelManager = {
  models: {},
  mixers: [],
  
  // Load a model on demand
  loadModel(path, options = {}) {
    console.log(`ModelManager: Attempting to load model: ${path}`);
    
    const isGLB = path.toLowerCase().endsWith('.glb') || path.toLowerCase().endsWith('.gltf');
    
    // Different default scale for GLB vs FBX
    const defaultOptions = {
      scale: isGLB ? 1.0 : 0.01, // GLB models are often already properly scaled
      position: new THREE.Vector3(0, 0, 0),
      rotation: new THREE.Euler(0, 0, 0),
      visible: true,
      delay: 0
    };
    
    const config = { ...defaultOptions, ...options };
    console.log(`ModelManager: Model config:`, {
      scale: config.scale,
      position: [config.position.x, config.position.y, config.position.z],
      visible: config.visible,
      delay: config.delay
    });
    
    if (this.models[path]) {
      console.log(`ModelManager: Model ${path} already loaded, reusing`);
      return Promise.resolve(this.models[path]);
    }
    
    return new Promise((resolve, reject) => {
      console.log(`ModelManager: Creating loader for ${path}`);
      
      // Choose loader based on file extension
      const isGLB = path.toLowerCase().endsWith('.glb') || path.toLowerCase().endsWith('.gltf');
      const loader = isGLB ? new GLTFLoader() : new FBXLoader();
      console.log(`ModelManager: Using ${isGLB ? 'GLTF' : 'FBX'} loader for ${path}`);
      
      // Check if the file exists before loading
      fetch(path, { method: 'HEAD' })
        .then(response => {
          if (!response.ok) {
            console.error(`ModelManager: File ${path} does not exist or is not accessible`);
            reject(new Error(`File ${path} not found`));
            return;
          }
          
          console.log(`ModelManager: File ${path} exists, proceeding with load`);
          
          // Load the model
          loader.load(
            path,
            (result) => {
              // For GLB/GLTF, the model is in result.scene
              const model = isGLB ? result.scene : result;
              console.log(`ModelManager: Raw result from loader:`, result);
              
              if (!model) {
                console.error(`ModelManager: Model is undefined after loading ${path}`);
                reject(new Error(`Model ${path} loaded but is undefined`));
                return;
              }
              
              console.log(`ModelManager: Model object structure:`, model);
              
              // Scale and position the model
              model.scale.set(config.scale, config.scale, config.scale);
              model.position.copy(config.position);
              model.rotation.copy(config.rotation);
              model.visible = config.visible;
              
              console.log(`ModelManager: Model loaded successfully: ${path}`);
              
              // Fix geometry and materials for each mesh in the model
              model.traverse(child => {
                if (child.isMesh) {
                  console.log(`ModelManager: Fixing mesh: ${child.name}`);
                  
                  // Fix geometry issues
                  if (child.geometry) {
                    child.geometry = fixGeometry(child.geometry);
                  }
                  
                  // Fix material issues
                  if (child.material) {
                    if (Array.isArray(child.material)) {
                      console.log(`ModelManager: Mesh ${child.name} has ${child.material.length} materials`);
                      child.material = child.material.map(mat => fixMaterial(mat));
                    } else {
                      child.material = fixMaterial(child.material);
                    }
                  }
                  
                  // Ensure proper rendering settings
                  child.frustumCulled = false; // Prevent culling issues
                  child.castShadow = true;
                  child.receiveShadow = true;
                }
              });
              
              // Handle animations (different for GLB)
              const modelMixer = new THREE.AnimationMixer(model);
              this.mixers.push(modelMixer);
              
              // Play animations if available (GLTF animations are in result.animations)
              const animations = isGLB ? result.animations : model.animations;
              console.log(`ModelManager: Animations found:`, animations);
              
              if (animations && animations.length > 0) {
                const action = modelMixer.clipAction(animations[0]);
                action.play();
                console.log(`ModelManager: Model ${path} has ${animations.length} animations, playing first one`);
              } else {
                console.log(`ModelManager: Model ${path} has no animations`);
              }
              
              // For GLB models, we need to traverse the scene to ensure materials are visible
              if (isGLB) {
                console.log(`ModelManager: Traversing GLB model to ensure materials are set up correctly`);
                model.traverse((child) => {
                  if (child.isMesh) {
                    console.log(`ModelManager: Found mesh in GLB:`, child.name);
                    // Ensure materials are set up for rendering
                    if (child.material) {
                      child.material.needsUpdate = true;
                      if (child.material.map) child.material.map.needsUpdate = true;
                    }
                  }
                });
              }
              
              // Add to models collection
              this.models[path] = {
                object: model,
                mixer: modelMixer,
                animations: animations || [],
                config: config,
                isGLB: isGLB
              };
              
              console.log(`ModelManager: Model ${path} added to manager`);
              
              resolve(this.models[path]);
            },
            (xhr) => {
              const percentComplete = Math.round((xhr.loaded / xhr.total) * 100);
              console.log(`ModelManager: ${path}: ${percentComplete}% loaded (${xhr.loaded}/${xhr.total} bytes)`);
              document.querySelector('.loading-text').textContent = `Loading ${path.split('/').pop()}: ${percentComplete}%`;
            },
            (error) => {
              console.error(`ModelManager: Error loading model ${path}:`, error);
              reject(error);
            }
          );
        })
        .catch(error => {
          console.error(`ModelManager: Error checking if file exists: ${path}`, error);
          reject(error);
        });
    });
  },
  
  // Fix animation issues with the model
  fixAnimations(model, path) {
    console.log(`ModelManager: Applying animation fixes for ${path}`);
    
    // Check if the model has a skeleton
    if (model.skeleton) {
      console.log(`ModelManager: Model has a skeleton, fixing bone transformations`);
      // Fix skeleton bone transformations
      model.skeleton.bones.forEach(bone => {
        // Apply corrections to specific bones if needed
        if (bone.name.includes('RightHand') || bone.name.includes('Hand_R') || 
            bone.name.includes('Weapon') || bone.name.includes('Gun')) {
          console.log(`ModelManager: Fixing weapon-related bone: ${bone.name}`);
          // Adjust rotation of weapon-holding bones to fix "dabbing" issue
          bone.rotation.z *= -1; // Flip Z rotation
        }
      });
    }
    
    // Fix animations if present
    if (model.animations && model.animations.length > 0) {
      console.log(`ModelManager: Model has ${model.animations.length} animations, fixing tracks`);
      
      model.animations.forEach((animation, index) => {
        // Log animation details
        console.log(`ModelManager: Animation ${index}: ${animation.name}, duration: ${animation.duration}s`);
        
        // Fix specific known issues with Army AR animations
        if (path.includes('ARMY AR') && animation.tracks) {
          this.fixArmyAnimations(animation);
        }
      });
    }
  },
  
  // Specific fixes for ARMY AR model animations
  fixArmyAnimations(animation) {
    // Look for problematic tracks related to weapon positioning
    animation.tracks.forEach(track => {
      // Identify tracks by name - focusing on weapon/arm rotation tracks
      if (track.name.includes('.quaternion') && 
         (track.name.includes('RightHand') || track.name.includes('Weapon') || 
          track.name.includes('Gun') || track.name.includes('Arm'))) {
        
        console.log(`ModelManager: Fixing problematic track: ${track.name}`);
        
        // Modify quaternion values for weapon rotation
        // This fixes the "dabbing" look when the gun goes behind the body
        if (track.values && track.values.length > 0) {
          // Adjust quaternion values for this track
          // We're applying a correction to how the rotations are applied
          for (let i = 0; i < track.values.length; i += 4) {
            // Invert relevant quaternion components to fix rotations
            // (Multiple by -1 to rotate in opposite direction)
            track.values[i + 2] *= -1; // z component
            track.values[i + 3] *= -1; // w component (flip rotation axis)
          }
        }
      }
    });
  },
  
  // Update all animation mixers
  updateAnimations(delta) {
    if (this.mixers.length > 0) {
      this.mixers.forEach(mixer => {
        mixer.update(delta);
      });
    }
  },
  
  // Show a model with optional delay
  showModel(path, delay = 0) {
    if (!this.models[path]) {
      console.warn(`ModelManager: Cannot show model ${path} - not loaded yet`);
      return;
    }
    
    if (delay > 0) {
      console.log(`ModelManager: Will show model ${path} after ${delay}s delay`);
      setTimeout(() => {
        this.models[path].object.visible = true;
        console.log(`ModelManager: Model ${path} is now visible (delayed)`);
      }, delay * 1000);
    } else {
      this.models[path].object.visible = true;
      console.log(`ModelManager: Model ${path} is now visible (immediate)`);
    }
  },
  
  // Hide a model
  hideModel(path) {
    if (this.models[path]) {
      this.models[path].object.visible = false;
      console.log(`ModelManager: Model ${path} is now hidden`);
    } else {
      console.warn(`ModelManager: Cannot hide model ${path} - not loaded`);
    }
  },
  
  // Clear all models
  clearModels() {
    console.log(`ModelManager: Clearing all models`);
    Object.keys(this.models).forEach(path => {
      if (this.models[path].object.parent) {
        this.models[path].object.parent.remove(this.models[path].object);
        console.log(`ModelManager: Removed model ${path} from scene`);
      }
    });
    this.models = {};
    this.mixers = [];
    console.log(`ModelManager: All models cleared`);
  }
};

// Initialize Three.js scene for test mode
const initTestScene = () => {
  console.log('Initializing test scene...');
  
  // Create scene, camera, and renderer
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
  
  console.log('Test scene created, setting up renderer...');
  
  renderer = new THREE.WebGLRenderer({ 
    antialias: true, 
    alpha: true,
    logarithmicDepthBuffer: true // Help with z-fighting issues
  });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  
  const arContainer = document.getElementById('ar-container');
  if (!arContainer) {
    console.error('AR container element not found!');
    return null;
  }
  
  arContainer.appendChild(renderer.domElement);
  console.log('Renderer attached to DOM');
  
  // Add lighting
  const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
  directionalLight.position.set(0, 5, 0);
  scene.add(directionalLight);
  
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
  scene.add(ambientLight);
  console.log('Lighting added to scene');
  
  // Position camera
  camera.position.z = 15;
  
  // Add a grid helper for reference
  const gridHelper = new THREE.GridHelper(10, 10);
  scene.add(gridHelper);
  console.log('Grid helper added to scene');
  
  // Animation loop
  const animate = () => {
    requestAnimationFrame(animate);
    
    const delta = clock.getDelta();
    ModelManager.updateAnimations(delta);
    
    renderer.render(scene, camera);
  };
  
  animate();
  console.log('Animation loop started');
  
  console.log('Test scene initialization complete');
  return { scene, camera, renderer };
};

// Get model configurations
const getModelConfigs = () => {
  console.log('Getting model configurations');
  
  // Check if models directory is accessible
  fetch('models/')
    .then(response => {
      console.log('Models directory check response:', response.status);
    })
    .catch(error => {
      console.error('Error checking models directory:', error);
    });
  
  // For testing, we'll use placeholder model paths
  const configs = [
    { 
      path: 'models/ARMY AR.glb', 
      position: new THREE.Vector3(-2, 0, 0),
      scale: 1.0,  // GLB models typically need a larger scale
      delay: 0 
    },
    { 
      path: 'models/Civilian.fbx', 
      position: new THREE.Vector3(-1, 0, 0),
      scale: 0.01,  // FBX models need small scale
      delay: 1,
      visible: false
    },
    { 
      path: 'models/DIS AR (human).fbx', 
      position: new THREE.Vector3(0, 0, 0),
      scale: 0.01,
      delay: 2,
      visible: false
    },
    { 
      path: 'models/NAVY AR.fbx', 
      position: new THREE.Vector3(1, 0, 0),
      scale: 0.01,
      delay: 3,
      visible: false
    },
    { 
      path: 'models/RSAF AR.fbx', 
      position: new THREE.Vector3(2, 0, 0),
      scale: 0.01,
      delay: 4,
      visible: false
    }
  ];
  
  console.log(`Returning ${configs.length} model configurations`);
  return configs;
};

// Load test models with sequential delays
const loadTestModels = async () => {
  console.log('Loading test models...');
  
  try {
    // Define models with positions and delays
    const modelConfigs = getModelConfigs();
    
    // For testing, we'll use a single model file if the others don't exist
    // This allows testing with just one model file
    let modelFile = 'models/ARMY AR.glb';
    console.log(`Using fallback model: ${modelFile}`);
    
    // Check fallback model exists
    try {
      const response = await fetch(modelFile, { method: 'HEAD' });
      if (!response.ok) {
        console.error(`Fallback model ${modelFile} does not exist. Will attempt loading anyway.`);
      } else {
        console.log(`Fallback model ${modelFile} exists and is accessible.`);
      }
    } catch (error) {
      console.error(`Error checking fallback model:`, error);
    }
    
    // Try loading just one model first
    console.log('Loading first model to test...');
    try {
      const firstModel = await ModelManager.loadModel(modelConfigs[0].path, {
        position: modelConfigs[0].position,
        visible: true
      });
      
      scene.add(firstModel.object);
      console.log('First model loaded and added to scene, now loading remaining models');
      
      // Load remaining models
      for (let i = 1; i < modelConfigs.length; i++) {
        const config = modelConfigs[i];
        console.log(`Loading model ${i+1} of ${modelConfigs.length}: ${config.path}`);
        
        try {
          const model = await ModelManager.loadModel(config.path, {
            position: config.position,
            visible: config.visible !== false
          });
          
          scene.add(model.object);
          console.log(`Model ${i+1} loaded and added to scene`);
        } catch (error) {
          console.warn(`Couldn't load ${config.path}, trying fallback model`);
          try {
            const fallbackModel = await ModelManager.loadModel(modelFile, {
              position: config.position,
              visible: config.visible !== false
            });
            
            scene.add(fallbackModel.object);
            console.log(`Fallback model loaded for ${config.path}`);
          } catch (fallbackError) {
            console.error(`Failed to load fallback model:`, fallbackError);
          }
        }
      }
      
    } catch (error) {
      console.error('Failed to load first model:', error);
      
      // Try loading fallback model
      try {
        const fallbackModel = await ModelManager.loadModel(modelFile, {
          position: new THREE.Vector3(0, 0, 0),
          visible: true
        });
        
        scene.add(fallbackModel.object);
        console.log('Fallback model loaded and added to scene');
      } catch (fallbackError) {
        console.error('Failed to load even the fallback model:', fallbackError);
        throw new Error('Cannot load any models');
      }
    }
    
    // Show models with delays
    console.log('Setting up delayed model visibility...');
    for (const config of modelConfigs) {
      if (config.visible === false && ModelManager.models[config.path]) {
        ModelManager.showModel(config.path, config.delay);
      }
    }
    
    console.log('All models loaded successfully');
    loadingElement.classList.add('hidden');
  } catch (error) {
    console.error('Error loading test models:', error);
    loadingElement.classList.add('hidden');
    document.querySelector('.loading-text').textContent = 'Error loading models';
  }
};

// Initialize MindAR with target tracking
const initializeAR = async () => {
  console.log('Initializing AR mode...');
  
  try {
    // Check if target file exists
    try {
      const response = await fetch('targets/targets.mind', { method: 'HEAD' });
      if (!response.ok) {
        console.error('Target file does not exist or is not accessible');
        throw new Error('Target file missing');
      }
      console.log('Target file exists and is accessible');
    } catch (error) {
      console.error('Error checking target file:', error);
      throw new Error('Cannot access target file');
    }
    
    console.log('Creating MindAR instance...');
    // Create MindAR image tracking system with Three.js integration
    mindarThree = new MindARThree({
      container: document.querySelector("#ar-container"),
      imageTargetSrc: 'targets/targets.mind',
      uiScanning: true,
      uiLoading: false, // We use our custom loading UI
      // Add logarithmic depth buffer option to fix z-fighting
      rendererOptions: { 
        logarithmicDepthBuffer: true 
      }
    });
    console.log('MindAR instance created');

    // Get Three.js scene, camera, and renderer from MindAR
    const { renderer, scene, camera } = mindarThree;
    console.log('Got scene, camera, and renderer from MindAR');

    // Create an anchor for the target image
    const anchor = mindarThree.addAnchor(0);
    console.log('Target anchor created');

    // Add lighting to the scene
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(0, 5, 0);
    scene.add(directionalLight);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);
    console.log('Lighting added to AR scene');

    // Define models with positions and delays
    const modelConfigs = getModelConfigs();
    
    // For testing, we'll use a single model file if the others don't exist
    let modelFile = 'models/ARMY AR.glb';
    console.log(`Using fallback model for AR mode: ${modelFile}`);
    
    // Load all models
    console.log('Loading models for AR mode...');
    for (const config of modelConfigs) {
      // Try to load the specified model, fall back to modelFile if it doesn't exist
      try {
        console.log(`Attempting to load ${config.path} for AR mode`);
        const model = await ModelManager.loadModel(config.path, {
          position: config.position,
          visible: config.visible !== false
        });
        
        anchor.group.add(model.object);
        console.log(`Added ${config.path} to AR anchor`);
      } catch (error) {
        console.warn(`Couldn't load ${config.path} for AR, trying fallback model`);
        try {
          const fallbackModel = await ModelManager.loadModel(modelFile, {
            position: config.position,
            visible: config.visible !== false
          });
          
          anchor.group.add(fallbackModel.object);
          console.log(`Added fallback model for ${config.path} to AR anchor`);
        } catch (fallbackError) {
          console.error(`Failed to load fallback model for AR:`, fallbackError);
        }
      }
    }
    
    // Show models with delays
    console.log('Setting up delayed model visibility for AR...');
    for (const config of modelConfigs) {
      if (config.visible === false) {
        ModelManager.showModel(config.path, config.delay);
      }
    }
    
    // Animation loop
    console.log('Setting up AR animation loop...');
    renderer.setAnimationLoop(() => {
      // Update animation mixers
      const delta = clock.getDelta();
      ModelManager.updateAnimations(delta);
      
      // Render the scene
      renderer.render(scene, camera);
    });
    
    console.log('AR initialization complete');
    return mindarThree;
  } catch (error) {
    console.error('Error initializing AR:', error);
    throw error;
  }
};

// Start AR experience
const startAR = async () => {
  console.log('Starting AR experience...');
  try {
    console.log('Showing loading screen');
    loadingElement.classList.remove('hidden');
    
    // Clean up any existing scene
    if (renderer) {
      console.log('Disposing previous renderer');
      renderer.dispose();
      document.getElementById('ar-container').innerHTML = '';
    }
    
    // Clear any existing models
    console.log('Clearing any existing models');
    ModelManager.clearModels();
    
    if (testMode) {
      console.log('Running in test mode');
      // Initialize test scene without AR
      const result = initTestScene();
      
      if (!result) {
        throw new Error('Failed to initialize test scene');
      }
      
      const { scene: testScene } = result;
      scene = testScene;
      console.log('Test scene initialized, loading models...');
      await loadTestModels();
    } else {
      console.log('Running in AR mode');
      // Check if targets.mind exists
      try {
        // Initialize AR with target tracking
        console.log('Initializing AR mode...');
        mindarThree = await initializeAR();
        console.log('Starting MindAR...');
        await mindarThree.start();
        console.log('MindAR started successfully');
      } catch (error) {
        console.error('Error starting AR mode:', error);
        document.querySelector('.loading-text').textContent = 'Error: Missing target file or camera permission';
        // Fall back to test mode
        console.log('Falling back to test mode');
        if (testModeToggle) testModeToggle.checked = true;
        testMode = true;
        const result = initTestScene();
        
        if (!result) {
          throw new Error('Failed to initialize fallback test scene');
        }
        
        const { scene: testScene } = result;
        scene = testScene;
        await loadTestModels();
      }
    }
    
    console.log('AR experience started successfully');
    loadingElement.classList.add('hidden');
  } catch (error) {
    console.error('Error starting AR:', error);
    loadingElement.classList.add('hidden');
    document.querySelector('.loading-text').textContent = 'Error starting AR';
  }
};

// Directly initialize on page load to diagnose loading issues
window.addEventListener('load', () => {
  console.log('Page loaded, running initial diagnostics...');
  
  // Check if DOM elements exist
  console.log('Checking UI elements:');
  console.log('- Loading element:', loadingElement ? 'found' : 'missing');
  console.log('- Start button:', startButton ? 'found' : 'missing');
  console.log('- Stop button:', stopButton ? 'found' : 'missing');
  console.log('- Test mode toggle:', testModeToggle ? 'found' : 'missing');
  console.log('- AR container:', document.getElementById('ar-container') ? 'found' : 'missing');
  
  // Check if files exist
  Promise.all([
    fetch('models/', { method: 'HEAD' }).catch(() => ({ ok: false, status: 404 })),
    fetch('targets/', { method: 'HEAD' }).catch(() => ({ ok: false, status: 404 })),
    fetch('js/main.js', { method: 'HEAD' }).catch(() => ({ ok: false, status: 404 }))
  ]).then(responses => {
    console.log('File access checks:');
    console.log('- models/ directory:', responses[0].ok ? 'accessible' : `inaccessible (${responses[0].status})`);
    console.log('- targets/ directory:', responses[1].ok ? 'accessible' : `inaccessible (${responses[1].status})`);
    console.log('- js/main.js:', responses[2].ok ? 'accessible' : `inaccessible (${responses[2].status})`);
  });
});

// Stop AR experience
const stopAR = async () => {
  console.log('Stopping AR experience...');
  if (testMode) {
    // Clean up test scene
    if (renderer) {
      console.log('Disposing test renderer');
      renderer.dispose();
      document.getElementById('ar-container').innerHTML = '';
    }
  } else if (mindarThree) {
    // Stop AR tracking
    console.log('Stopping MindAR tracking');
    await mindarThree.stop();
    mindarThree.renderer.setAnimationLoop(null);
  }
  
  // Clear models
  console.log('Clearing models');
  ModelManager.clearModels();
  console.log('AR experience stopped');
};

// Handle window resize
window.addEventListener('resize', () => {
  console.log('Window resized');
  if (testMode && renderer) {
    // Update camera aspect ratio and renderer size
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    console.log('Renderer resized');
  }
  // MindAR handles resize automatically in AR mode
});

// Event listeners
if (startButton) {
  startButton.addEventListener('click', startAR);
  console.log('Start button event listener attached');
} else {
  console.warn('Start button not found, cannot attach event listener');
}

if (stopButton) {
  stopButton.addEventListener('click', stopAR);
  console.log('Stop button event listener attached');
} else {
  console.warn('Stop button not found, cannot attach event listener');
}

// Handle errors
window.addEventListener('error', (error) => {
  console.error('Application error:', error);
  if (document.querySelector('.loading-text')) {
    document.querySelector('.loading-text').textContent = 'Application error';
  }
}); 