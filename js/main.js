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

  // Convert MeshPhongMaterial to MeshStandardMaterial for better PBR
  if (material.isMeshPhongMaterial) {
    console.log('Converting MeshPhongMaterial to MeshStandardMaterial');
    const standardMaterial = new THREE.MeshStandardMaterial();

    // Copy basic properties
    standardMaterial.map = material.map;
    standardMaterial.color.copy(material.color);
    standardMaterial.transparent = material.transparent;
    standardMaterial.opacity = material.opacity;
    standardMaterial.side = THREE.DoubleSide;

    // PBR properties
    standardMaterial.roughness = 0.6; // Moderate roughness
    standardMaterial.metalness = 0.0; // Non-metallic material

    // Ensure textures are properly set up
    if (standardMaterial.map) {
      standardMaterial.map.colorSpace = THREE.SRGBColorSpace;
      standardMaterial.map.needsUpdate = true;
    }

    // Copy normal map if exists
    if (material.normalMap) {
      standardMaterial.normalMap = material.normalMap;
      standardMaterial.normalScale.copy(material.normalScale);
    }

    console.log('Created MeshStandardMaterial:', standardMaterial);
    return standardMaterial;
  }

  // For non-Phong materials, apply basic fixes
  material.side = THREE.DoubleSide;

  if (material.transparent) {
    material.opacity = 1.0;
    material.alphaTest = 0.01;
    material.depthWrite = true;
  }

  if (material.map) {
    material.map.colorSpace = THREE.SRGBColorSpace;
    material.map.needsUpdate = true;
  }

  if (material.normalMap) {
    material.normalMap.needsUpdate = true;
    material.normalScale.set(1, 1);
  }

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

// ModelManager for handling model loading and animations
const ModelManager = {
  models: {},
  mixers: {},
  actions: {},
  cycleTimer: null,
  cycleInterval: 18000, // 14 seconds before reset

  // Load a model from the given path with options
  async loadModel(path, options = {}) {
    console.log(`Loading model: ${path} with options:`, options);

    // Default options
    const defaultOptions = {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: path.toLowerCase().endsWith('.glb') ? 1.0 : 0.01,
      visible: true,
      delay: 0
    };

    // Merge options with defaults
    const modelOptions = { ...defaultOptions, ...options };
    console.log(`Final model options for ${path}:`, modelOptions);

    try {
      // Check if file exists
      try {
        const response = await fetch(path, { method: 'HEAD' });
        if (!response.ok) {
          console.error(`Model file not found: ${path}`);
          throw new Error(`Model file not found: ${path}`);
        }
        console.log(`Model file exists: ${path}`);
      } catch (error) {
        console.error(`Error checking model file: ${path}`, error);
        throw new Error(`Cannot access model file: ${path}`);
      }

      // Load model based on file extension
      let object;
      let animations = [];

      if (path.toLowerCase().endsWith('.fbx')) {
        console.log(`Loading FBX model: ${path}`);
        const loader = new FBXLoader();
        object = await loader.loadAsync(path);

        if (object.animations && object.animations.length > 0) {
          console.log(`FBX has ${object.animations.length} animations`);
          animations = object.animations;
        }
      } else if (path.toLowerCase().endsWith('.glb') || path.toLowerCase().endsWith('.gltf')) {
        console.log(`Loading GLTF/GLB model: ${path}`);
        const loader = new GLTFLoader();
        const gltf = await loader.loadAsync(path);
        object = gltf.scene;

        if (gltf.animations && gltf.animations.length > 0) {
          console.log(`GLTF/GLB has ${gltf.animations.length} animations`);
          animations = gltf.animations;
        }
      } else {
        throw new Error(`Unsupported model format: ${path}`);
      }

      // Set position, rotation, and scale
      object.position.set(
        modelOptions.position.x,
        modelOptions.position.y,
        modelOptions.position.z
      );

      object.rotation.set(
        modelOptions.rotation.x,
        modelOptions.rotation.y,
        modelOptions.rotation.z
      );

      // Apply scale (different default for GLB vs FBX)
      object.scale.set(modelOptions.scale, modelOptions.scale, modelOptions.scale);

      // Check if this is the dis-ball model and apply special material
      if (path.includes('dis-ball')) {
        console.log('Detected dis-ball model, applying warm emissive material');
        object = applyWarmEmissiveMaterial(object);
      } else {
        // Fix materials for other models
        object.traverse((child) => {
          if (child.isMesh) {
            console.log(`Fixing materials for mesh: ${child.name}`);
            child.material = fixMaterial(child.material);

            // Fix geometry if needed
            if (child.geometry) {
              child.geometry = fixGeometry(child.geometry);
            }
          }
        });
      }

      // Set initial visibility
      object.visible = modelOptions.visible;

      // Create animation mixer if there are animations
      if (animations.length > 0) {
        console.log(`Setting up animations for ${path}`);
        const mixer = new THREE.AnimationMixer(object);
        this.mixers[path] = mixer;

        // Fix animations if needed
        animations = this.fixAnimations(animations, path);

        // Create animation actions
        const actions = {};
        animations.forEach((animation, index) => {
          const actionName = animation.name || `animation_${index}`;
          console.log(`Creating action for animation: ${actionName}`);

          // Create the action
          const action = mixer.clipAction(animation);

          // Configure the action to play only once
          action.loop = THREE.LoopOnce;
          action.clampWhenFinished = true; // Holds the last frame when finished

          // Set initial state to paused
          action.paused = true;
          action.play();

          actions[actionName] = action;
        });

        this.actions[path] = actions;
        console.log(`Created ${Object.keys(actions).length} animation actions for ${path}`);

        // Set up animation finished callback
        mixer.addEventListener('finished', (e) => {
          console.log(`Animation finished for ${path}`);
          // Animation has completed its single play
        });
      }

      // Store the model
      this.models[path] = {
        object,
        options: modelOptions,
        animations
      };

      console.log(`Model loaded successfully: ${path}`);

      // If there's a delay and the model should be initially hidden, set up delayed visibility
      if (modelOptions.delay > 0 && !modelOptions.visible) {
        this.showModel(path, modelOptions.delay);
      }

      return this.models[path];
    } catch (error) {
      console.error(`Error loading model ${path}:`, error);
      throw error;
    }
  },

  // Fix animations for specific models
  fixAnimations(animations, path) {
    console.log(`Checking if animations need fixing for ${path}`);

    // Check if this is the Army AR model that needs fixing
    if (path.includes('ARMY AR')) {
      console.log('Fixing Army AR animations');
      return animations.map(animation => this.fixArmyAnimations(animation));
    }

    return animations;
  },

  // Fix Army AR animations
  fixArmyAnimations(animation) {
    console.log(`Fixing animation: ${animation.name || 'unnamed'}`);

    // Clone the animation to avoid modifying the original
    const fixedAnimation = animation.clone();

    // Fix each track in the animation
    for (let i = 0; i < fixedAnimation.tracks.length; i++) {
      const track = fixedAnimation.tracks[i];

      // Fix quaternion tracks (rotations)
      if (track.name.includes('quaternion')) {
        console.log(`Fixing quaternion track: ${track.name}`);

        // Adjust quaternion values if needed
        // This is where specific fixes for the Army AR model would go
      }
    }

    return fixedAnimation;
  },

  // Update all animation mixers
  updateAnimations(delta) {
    Object.keys(this.mixers).forEach(path => {
      this.mixers[path].update(delta);
    });

    // Update custom animations for models
    Object.keys(this.models).forEach(path => {
      const model = this.models[path];
      if (model.object && model.object.userData && model.object.userData.update) {
        model.object.userData.update(delta);
      }
    });
  },

  // Show a model after a delay
  showModel(path, delay = 0) {
    if (!this.models[path]) {
      console.warn(`Cannot show model ${path}: not loaded`);
      return;
    }

    console.log(`Setting up model ${path} to show after ${delay}ms delay`);

    setTimeout(() => {
      console.log(`Showing model ${path} after delay`);
      this.models[path].object.visible = true;

      // Start animations when the model becomes visible
      if (this.actions[path]) {
        console.log(`Starting animations for ${path}`);
        Object.keys(this.actions[path]).forEach(actionName => {
          const action = this.actions[path][actionName];

          // Reset the animation to start from the beginning
          action.reset();
          action.paused = false;
          action.play();

          console.log(`Started animation: ${actionName}`);
        });
      }
    }, delay);
  },

  // Hide a model
  hideModel(path) {
    if (!this.models[path]) {
      console.warn(`Cannot hide model ${path}: not loaded`);
      return;
    }

    console.log(`Hiding model ${path}`);
    this.models[path].object.visible = false;

    // Pause animations when the model is hidden
    if (this.actions[path]) {
      console.log(`Pausing animations for ${path}`);
      Object.keys(this.actions[path]).forEach(actionName => {
        const action = this.actions[path][actionName];
        action.paused = true;
      });
    }
  },

  // Hide all models
  hideAllModels() {
    console.log('Hiding all models');
    Object.keys(this.models).forEach(path => {
      this.hideModel(path);
    });
  },

  // Reset all models (hide and then show with original delays)
  resetModels() {
    console.log('Resetting all models');

    // First hide all models
    this.hideAllModels();

    // Reset all animation mixers and actions
    Object.keys(this.models).forEach(path => {
      if (this.mixers[path]) {
        // Stop the current mixer
        this.mixers[path].stopAllAction();

        // Create a new mixer to reset all animations
        const model = this.models[path];
        const newMixer = new THREE.AnimationMixer(model.object);
        this.mixers[path] = newMixer;

        // Set up animation finished callback
        newMixer.addEventListener('finished', (e) => {
          console.log(`Animation finished for ${path}`);
          // Animation has completed its single play
        });

        // Recreate all actions
        if (model.animations && model.animations.length > 0) {
          const actions = {};
          model.animations.forEach((animation, index) => {
            const actionName = animation.name || `animation_${index}`;
            console.log(`Recreating action for animation: ${actionName}`);

            // Create the action
            const action = newMixer.clipAction(animation);

            // Configure the action to play only once
            action.loop = THREE.LoopOnce;
            action.clampWhenFinished = true; // Holds the last frame when finished

            // Set initial state to paused
            action.paused = true;
            action.reset();
            action.play();

            actions[actionName] = action;
          });

          this.actions[path] = actions;
        }
      }
    });

    // Then show them again with their original delays
    Object.keys(this.models).forEach(path => {
      const { options } = this.models[path];
      this.showModel(path, options.delay);
    });
  },

  // Start the automatic reset cycle
  startResetCycle() {
    console.log(`Starting reset cycle with interval of ${this.cycleInterval}ms`);

    // Clear any existing timer
    if (this.cycleTimer) {
      clearInterval(this.cycleTimer);
    }

    // Set up the interval timer
    this.cycleTimer = setInterval(() => {
      console.log('Reset cycle triggered');
      this.resetModels();
    }, this.cycleInterval);
  },

  // Stop the automatic reset cycle
  stopResetCycle() {
    console.log('Stopping reset cycle');
    if (this.cycleTimer) {
      clearInterval(this.cycleTimer);
      this.cycleTimer = null;
    }
  },

  // Clear all models
  clearModels() {
    console.log('Clearing all models');

    // Stop the reset cycle
    this.stopResetCycle();

    // Dispose mixers
    Object.keys(this.mixers).forEach(path => {
      console.log(`Disposing mixer for ${path}`);
      delete this.mixers[path];
    });

    // Clear actions
    this.actions = {};

    // Clear models
    this.models = {};

    console.log('All models cleared');
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
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const arContainer = document.getElementById('ar-container');
  if (!arContainer) {
    console.error('AR container element not found!');
    return null;
  }

  arContainer.appendChild(renderer.domElement);
  console.log('Renderer attached to DOM');

  // Add lighting
  const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0);
  directionalLight.position.set(1, 2, 3);
  scene.add(directionalLight);

  const ambientLight = new THREE.AmbientLight(0xffffff, 1.0);
  scene.add(ambientLight);
  console.log('Lighting added to scene');

  // Position camera
  camera.position.set(0, 3, 15);

  // Add a grid helper for reference
  // const gridHelper = new THREE.GridHelper(10, 10);
  // scene.add(gridHelper);
  // console.log('Grid helper added to scene');

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
  console.log('Getting model configurations...');

  // Model configurations - edit these values to control model appearance and timing
  const configs = [

    //first right
    {
      id: 'army',
      name: 'Army AR',
      path: 'models/army-ar.glb',
      position: { x: 1.5, y: 0, z: 1 },
      scale: 1,
      delay: 2000,
      visible: false,
      enabled: true
    },
    // center
    {
      id: 'civilian',
      name: 'Civilian',
      path: 'models/civilian.fbx',
      position: { x: 0, y: 0, z: 3 },
      scale: 0.01,
      delay: 100,
      visible: false,
      enabled: true
    },
    // first left
    {
      id: 'rsaf',
      name: 'RSAF AR',
      path: 'models/rsaf.fbx',
      position: { x: -1.5, y: 0, z: 1 },
      scale: 0.01,
      delay: 3500,
      visible: false,
      enabled: true
    },
    // far left
    {
      id: 'dis',
      name: 'DIS AR',
      path: 'models/dis.glb',
      position: { x: -3, y: 0, z: 0 },
      scale: 1,
      delay: 6500,
      visible: false,
      enabled: true
    },
    {
      id: 'ball',
      name: 'DIS Ball',
      path: 'models/dis-ball.fbx',
      position: { x: -3.1, y: 1.6, z: 1.4 },
      scale: 0.007,
      delay: 11000,
      visible: false,
      enabled: true
    },
    // far right
    {
      id: 'navy',
      name: 'Navy AR',
      path: 'models/navy.fbx',
      position: { x: 3, y: 0, z: 0 },
      scale: 0.01,
      delay: 5000,
      visible: false,
      enabled: true
    },
  ];

  console.log(`Returning ${configs.length} model configurations`);
  return configs;
};

// Create a simple spotlight cylinder without animations
function createSpotlightCylinder(position, scale = 1.0) {
  console.log('Creating simple spotlight cylinder at position:', position);

  // Create geometry - tapered cylinder (cone-like)
  const radiusTop = 0.6; // Slightly smaller top
  const radiusBottom = 2;
  const height = 15.0;
  const radialSegments = 16;
  const geometry = new THREE.CylinderGeometry(
    radiusBottom,
    radiusTop,
    height,
    radialSegments
  );

  // Create simple emissive, transparent material
  const material = new THREE.MeshStandardMaterial({
    emissive: new THREE.Color(0xffbbaa),
    emissiveIntensity: 1,
    transparent: true,
    opacity: 0.1,
    side: THREE.DoubleSide,
    depthWrite: false // Prevent z-fighting with other transparent objects
  });

  // Create mesh
  const cylinder = new THREE.Mesh(geometry, material);

  // Position the cylinder above the model
  cylinder.position.set(
    position.x,
    position.y + 8, // Position above the model
    position.z + 5
  );

  // Rotate to point downward
  cylinder.rotation.x = Math.PI; // Rotate 180 degrees around X axis

  // Initially invisible
  cylinder.visible = false;

  console.log('Simple spotlight cylinder created');
  return cylinder;
}

// Load test models with sequential delays
const loadTestModels = async () => {
  console.log('Loading test models...');

  try {
    // Get model configurations
    const modelConfigs = getModelConfigs();

    // Create an array to store spotlight cylinders
    const spotlights = [];

    // Load each enabled model
    for (const config of modelConfigs) {
      if (!config.enabled) {
        console.log(`Skipping disabled model: ${config.path}`);
        continue;
      }

      try {
        console.log(`Loading model: ${config.path}`);
        const model = await ModelManager.loadModel(config.path, {
          position: config.position,
          scale: config.scale,
          visible: config.visible,
          delay: config.delay
        });

        if (model) {
          scene.add(model.object);
          console.log(`Added ${config.path} to test scene`);

          // Skip creating spotlight for dis-ball model
          if (config.path.includes('dis-ball')) {
            console.log(`Skipping spotlight for ${config.path} as requested`);
            continue;
          }

          // Create a spotlight cylinder for this model
          const spotlight = createSpotlightCylinder(
            config.position,
            config.path.includes('glb') ? 1.5 : 0.8 // Larger for GLB models
          );

          // Add to scene
          scene.add(spotlight);

          // Store reference to the spotlight
          spotlights.push({
            spotlight,
            delay: config.delay + 500,
            modelPath: config.path
          });

          console.log(`Added spotlight for ${config.path}`);
        }
      } catch (error) {
        console.error(`Failed to load model ${config.path}:`, error);
        displayErrorMessage(`Failed to load ${config.path}`);
      }
    }

    // Show spotlights with the same delays as their models
    spotlights.forEach(({ spotlight, delay, modelPath }) => {
      setTimeout(() => {
        console.log(`Showing spotlight for ${modelPath} after ${delay}ms`);
        spotlight.visible = true;
      }, delay);
    });

    // Start the automatic reset cycle
    ModelManager.startResetCycle();

    // Update the reset models function to also reset spotlights
    const originalResetModels = ModelManager.resetModels;
    ModelManager.resetModels = function () {
      // Call the original reset function
      originalResetModels.call(this);

      // Hide all spotlights
      spotlights.forEach(({ spotlight }) => {
        spotlight.visible = false;
      });

      // Show spotlights again with their delays
      spotlights.forEach(({ spotlight, delay, modelPath }) => {
        setTimeout(() => {
          console.log(`Showing spotlight for ${modelPath} after reset`);
          spotlight.visible = true;
        }, delay);
      });
    };

    console.log('All test models and spotlights loaded');
  } catch (error) {
    console.error('Error loading test models:', error);
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
    mindarThree = new MindARThree({
      container: document.querySelector("#ar-container"),
      imageTargetSrc: 'targets/targets.mind',
      uiScanning: true,
      uiLoading: false,
      rendererOptions: {
        antialias: true,
        alpha: true,
        logarithmicDepthBuffer: true,
        outputColorSpace: THREE.SRGBColorSpace
      }
    });
    console.log('MindAR instance created');

    const { renderer, scene, camera } = mindarThree;
    console.log('Got scene, camera, and renderer from MindAR');

    const anchor = mindarThree.addAnchor(0);
    console.log('Target anchor created');

    // Add lighting
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0);
    directionalLight.position.set(1, 2, 3);
    scene.add(directionalLight);

    const ambientLight = new THREE.AmbientLight(0xffffff, 1.0);
    scene.add(ambientLight);
    console.log('Lighting added to AR scene');

    // Load models with the ModelManager
    const modelConfigs = getModelConfigs();

    // Create an array to store spotlight cylinders
    const spotlights = [];

    for (const config of modelConfigs) {
      if (!config.enabled) {
        console.log(`Skipping disabled model: ${config.path}`);
        continue;
      }

      try {
        console.log(`Loading model: ${config.path}`);
        const model = await ModelManager.loadModel(config.path, {
          position: config.position,
          scale: config.scale,
          visible: config.visible,
          delay: config.delay
        });

        if (model) {
          // Add model to anchor group
          anchor.group.add(model.object);
          console.log(`Added ${config.path} to AR anchor`);

          // Skip creating spotlight for dis-ball model
          if (config.path.includes('dis-ball')) {
            console.log(`Skipping spotlight for ${config.path} in AR mode as requested`);
            continue;
          }

          // Create a spotlight cylinder for this model
          const spotlight = createSpotlightCylinder(
            config.position,
            config.path.includes('glb') ? 1.5 : 0.8 // Larger for GLB models
          );

          // Add to anchor group
          anchor.group.add(spotlight);

          // Store reference to the spotlight
          spotlights.push({
            spotlight,
            delay: config.delay,
            modelPath: config.path
          });

          console.log(`Added spotlight for ${config.path} in AR mode`);
        }
      } catch (error) {
        console.error(`Failed to load model ${config.path}:`, error);
        displayErrorMessage(`Failed to load ${config.path}`);
      }
    }

    // Show spotlights with the same delays as their models
    spotlights.forEach(({ spotlight, delay, modelPath }) => {
      setTimeout(() => {
        console.log(`Showing spotlight for ${modelPath} after ${delay}ms in AR mode`);
        spotlight.visible = true;
      }, delay);
    });

    // Update the reset models function to also reset spotlights in AR mode
    const originalResetModels = ModelManager.resetModels;
    ModelManager.resetModels = function () {
      // Call the original reset function
      originalResetModels.call(this);

      // Hide all spotlights
      spotlights.forEach(({ spotlight }) => {
        spotlight.visible = false;
      });

      // Show spotlights again with their delays
      spotlights.forEach(({ spotlight, delay, modelPath }) => {
        setTimeout(() => {
          console.log(`Showing spotlight for ${modelPath} after reset in AR mode`);
          spotlight.visible = true;
        }, delay);
      });
    };

    // Animation loop
    renderer.setAnimationLoop(() => {
      const delta = clock.getDelta();
      ModelManager.updateAnimations(delta);

      renderer.render(scene, camera);
    });

    return mindarThree;
  } catch (error) {
    console.error('Error initializing AR:', error);
    throw error;
  }
};

// Display error message in the scene
function displayErrorMessage(message) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = '24px Arial';
  ctx.fillStyle = 'white';
  ctx.textAlign = 'center';
  ctx.fillText('Error Loading Model:', canvas.width / 2, 100);
  ctx.fillText(message, canvas.width / 2, 140);
  ctx.fillText('Check console for details', canvas.width / 2, 180);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const geometry = new THREE.PlaneGeometry(4, 2);
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true
  });

  const plane = new THREE.Mesh(geometry, material);
  scene.add(plane);

  return plane;
}

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

// Apply warm emissive material to dis-ball model
function applyWarmEmissiveMaterial(object) {
  console.log('Applying simple warm emissive material to dis-ball');

  // Create a warm emissive material
  const warmEmissiveMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0xffffff), // Warm orange-yellow color
    emissive: new THREE.Color(0xff6600), // Warm orange emissive color
    emissiveIntensity: 3, // Strong emissive effect
    roughness: 0.3, // Slightly glossy
    side: THREE.DoubleSide // Render both sides
  });

  // Apply the material to the object
  object.traverse(child => {
    if (child.isMesh) {
      console.log(`Applying warm emissive material to mesh: ${child.name}`);

      // Store the original material for reference
      child.userData.originalMaterial = child.material;

      // Apply the new material
      child.material = warmEmissiveMaterial;
    }
  });

  console.log('Warm emissive material applied');
  return object;
} 