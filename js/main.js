import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { MindARThree } from 'mindar-image-three';

// DOM elements
const loadingElement = document.querySelector('.loading');
const startButton = document.getElementById('startButton');
const stopButton = document.getElementById('stopButton');

// Global variables
let mindarThree = null;
let clock = new THREE.Clock();
let scene, camera, renderer;
let orbitControls = null;
let defaultCameraPosition = new THREE.Vector3(0, 0, 5);
let testMode = false; // Default to test mode (true) - change to false for AR mode

// Add window resize handler to ensure proper sizing
window.addEventListener('resize', () => {
  if (renderer) {
    const width = window.innerWidth;
    const height = window.innerHeight;

    // Update renderer size
    renderer.setSize(width, height);

    // Update camera aspect ratio if it exists
    if (camera && camera.aspect) {
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    }
  }
});

// Helper functions for model fixes
// Fix material issues
function fixMaterial(material) {
  // Convert MeshPhongMaterial to MeshStandardMaterial for better PBR
  if (material.isMeshPhongMaterial) {
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
  // Check and fix normal vectors if needed
  if (geometry.attributes.normal) {
    geometry.computeVertexNormals(); // Recompute normals
    geometry.attributes.normal.needsUpdate = true;
  } else {
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

    try {
      // Check if file exists
      try {
        const response = await fetch(path, { method: 'HEAD' });
        if (!response.ok) {
          console.error(`Model file not found: ${path}`);
          throw new Error(`Model file not found: ${path}`);
        }
      } catch (error) {
        console.error(`Error checking model file: ${path}`, error);
        throw new Error(`Cannot access model file: ${path}`);
      }

      // Load model based on file extension
      let object;
      let animations = [];

      if (path.toLowerCase().endsWith('.fbx')) {
        const loader = new FBXLoader();
        object = await loader.loadAsync(path);

        if (object.animations && object.animations.length > 0) {
          animations = object.animations;
        }
      } else if (path.toLowerCase().endsWith('.glb') || path.toLowerCase().endsWith('.gltf')) {
        const loader = new GLTFLoader();
        const gltf = await loader.loadAsync(path);
        object = gltf.scene;

        if (gltf.animations && gltf.animations.length > 0) {
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
        object = applyWarmEmissiveMaterial(object);
      } else {
        // Fix materials for other models
        object.traverse((child) => {
          if (child.isMesh) {
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
        const mixer = new THREE.AnimationMixer(object);
        this.mixers[path] = mixer;

        // Fix animations if needed
        animations = this.fixAnimations(animations, path);

        // Create animation actions
        const actions = {};
        animations.forEach((animation, index) => {
          const actionName = animation.name || `animation_${index}`;
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

        // Set up animation finished callback
        mixer.addEventListener('finished', (e) => {
          // Animation has completed its single play
        });
      }

      // Store the model
      this.models[path] = {
        object,
        options: modelOptions,
        animations
      };

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

    // Check if this is the Army AR model that needs fixing
    if (path.includes('ARMY AR')) {
      return animations.map(animation => this.fixArmyAnimations(animation));
    }

    return animations;
  },

  // Fix Army AR animations
  fixArmyAnimations(animation) {
    // Clone the animation to avoid modifying the original
    const fixedAnimation = animation.clone();

    // Fix each track in the animation
    for (let i = 0; i < fixedAnimation.tracks.length; i++) {
      const track = fixedAnimation.tracks[i];

      // Fix quaternion tracks (rotations)
      if (track.name.includes('quaternion')) {
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

    // In AR mode, we'll handle showing models through the animation sequence
    if (!testMode && mindarThree) {
      return;
    }

    setTimeout(() => {
      this.models[path].object.visible = true;

      // Start animations when the model becomes visible
      if (this.actions[path]) {
        Object.keys(this.actions[path]).forEach(actionName => {
          const action = this.actions[path][actionName];

          // Reset the animation to start from the beginning
          action.reset();
          action.paused = false;
          action.play();
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
    this.models[path].object.visible = false;

    // Pause animations when the model is hidden
    if (this.actions[path]) {
      Object.keys(this.actions[path]).forEach(actionName => {
        const action = this.actions[path][actionName];
        action.paused = true;
      });
    }
  },

  // Hide all models
  hideAllModels() {
    Object.keys(this.models).forEach(path => {
      this.hideModel(path);
    });
  },

  // Reset all models (hide and then show with original delays)
  resetModels() {
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
        // newMixer.addEventListener('finished', (e) => {
        //   console.log(`Animation finished for ${path}`);
        //   // Animation has completed its single play
        // });

        // Recreate all actions
        if (model.animations && model.animations.length > 0) {
          const actions = {};
          model.animations.forEach((animation, index) => {
            const actionName = animation.name || `animation_${index}`;

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
    // Clear any existing timer
    if (this.cycleTimer) {
      clearInterval(this.cycleTimer);
    }

    // Set up the interval timer
    this.cycleTimer = setInterval(() => {
      this.resetModels();
    }, this.cycleInterval);
  },

  // Stop the automatic reset cycle
  stopResetCycle() {
    if (this.cycleTimer) {
      clearInterval(this.cycleTimer);
      this.cycleTimer = null;
    }
  },

  // Clear all models
  clearModels() {
    // Stop the reset cycle
    this.stopResetCycle();

    // Dispose mixers
    Object.keys(this.mixers).forEach(path => {
      delete this.mixers[path];
    });

    // Clear actions
    this.actions = {};

    // Clear models
    this.models = {};
  }
};

// Initialize Three.js scene for test mode
const initTestScene = () => {
  // Create scene, camera, and renderer
  scene = new THREE.Scene();
  // Set black background
  scene.background = new THREE.Color(0x000000);

  camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);

  renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true, // Enable transparency
    logarithmicDepthBuffer: true // Help with z-fighting issues
  });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000, 0); // Set clear color with 0 alpha (fully transparent)
  renderer.sortObjects = true; // Enable manual sorting of transparent objects

  const arContainer = document.getElementById('ar-container');
  if (!arContainer) {
    console.error('AR container element not found!');
    return null;
  }

  arContainer.appendChild(renderer.domElement);

  // Add lighting
  const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0);
  directionalLight.position.set(1, 2, 3);
  scene.add(directionalLight);

  const ambientLight = new THREE.AmbientLight(0xffffff, 1.0);
  scene.add(ambientLight);

  // Position camera
  camera.position.copy(defaultCameraPosition);

  // Add orbit controls for test mode
  orbitControls = new OrbitControls(camera, renderer.domElement);
  orbitControls.enableDamping = true; // Add smooth damping effect
  orbitControls.dampingFactor = 0.05;
  orbitControls.screenSpacePanning = false;
  orbitControls.minDistance = 1;
  orbitControls.maxDistance = 15;
  orbitControls.maxPolarAngle = Math.PI / 1.5; // Limit rotation to prevent going below the scene

  // Create a reset camera button
  const resetCameraButton = document.createElement('button');
  resetCameraButton.textContent = 'Reset Camera';
  resetCameraButton.style.position = 'absolute';
  resetCameraButton.style.bottom = '20px';
  resetCameraButton.style.right = '20px';
  resetCameraButton.style.zIndex = '1000';
  resetCameraButton.style.padding = '10px 15px';
  resetCameraButton.style.backgroundColor = '#007bff';
  resetCameraButton.style.color = 'white';
  resetCameraButton.style.border = 'none';
  resetCameraButton.style.borderRadius = '5px';
  resetCameraButton.style.cursor = 'pointer';
  resetCameraButton.style.fontWeight = 'bold';
  resetCameraButton.style.boxShadow = '0 2px 5px rgba(0,0,0,0.2)';

  resetCameraButton.addEventListener('click', () => {
    // Animate camera back to default position
    const startPosition = camera.position.clone();
    const startQuaternion = camera.quaternion.clone();
    const endQuaternion = new THREE.Quaternion();
    const duration = 1000; // 1 second
    const startTime = Date.now();

    function animateReset() {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);

      // Use easing function for smooth animation
      const easeProgress = 1 - Math.pow(1 - progress, 3); // Cubic ease out

      // Interpolate position
      camera.position.lerpVectors(startPosition, defaultCameraPosition, easeProgress);

      // Interpolate rotation
      THREE.Quaternion.slerp(startQuaternion, endQuaternion, camera.quaternion, easeProgress);

      // Update orbit controls target
      orbitControls.target.set(0, 0, 0);
      orbitControls.update();

      if (progress < 1) {
        requestAnimationFrame(animateReset);
      }
    }

    animateReset();
  });

  arContainer.appendChild(resetCameraButton);

  // Animation loop
  const animate = () => {
    requestAnimationFrame(animate);

    // Update orbit controls
    if (orbitControls) {
      orbitControls.update();
    }

    const delta = clock.getDelta();
    ModelManager.updateAnimations(delta);

    renderer.render(scene, camera);
  };

  animate();
  return { scene, camera, renderer };
};

// Get model configurations
const getModelConfigs = () => {
  // Model configurations - edit these values to control model appearance and timing
  const configs = [

    //first right
    {
      id: 'army',
      name: 'Army AR',
      path: 'models/army-ar.glb',
      position: { x: 0.5, y: -1, z: .2 },
      scale: 0.3,
      delay: 2000,
      visible: false,
      enabled: true
    },
    // center
    {
      id: 'civilian',
      name: 'Civilian',
      path: 'models/civilian.fbx',
      position: { x: 0, y: -1, z: 1 },
      scale: 0.003,
      delay: 100,
      visible: false,
      enabled: true
    },
    // first left
    {
      id: 'rsaf',
      name: 'RSAF AR',
      path: 'models/rsaf.fbx',
      position: { x: -0.5, y: -1, z: 0.5 },
      scale: 0.003,
      delay: 3500,
      visible: false,
      enabled: true
    },
    // far left
    {
      id: 'dis',
      name: 'DIS AR',
      path: 'models/dis.glb',
      position: { x: -1, y: -1, z: 0 },
      scale: 0.3,
      delay: 6500,
      visible: false,
      enabled: true
    },
    {
      id: 'ball',
      name: 'DIS Ball',
      path: 'models/dis-ball.fbx',
      position: { x: -1, y: -0.6, z: 0.5 },
      scale: 0.0021,
      delay: 11000,
      visible: false,
      enabled: true
    },
    // far right
    {
      id: 'navy',
      name: 'Navy AR',
      path: 'models/navy.fbx',
      position: { x: 1, y: -1, z: 0.3 },
      scale: 0.003,
      delay: 5000,
      visible: false,
      enabled: true
    },
  ];
  return configs;
};

// Create a simple spotlight cylinder without animations
function createSpotlightCylinder(position, scale = 1.0) {
  // Create geometry - tapered cylinder (cone-like)
  const radiusTop = 0.5; // Slightly smaller top
  const radiusBottom = 2;
  const height = 8.0;
  const radialSegments = 16;
  const geometry = new THREE.CylinderGeometry(
    radiusBottom,
    radiusTop,
    height,
    radialSegments
  );

  // Create simple emissive, transparent material
  const material = new THREE.MeshStandardMaterial({
    // emissive: new THREE.Color(0xff4444),
    emissive: new THREE.Color(0xffbbaa),
    emissiveIntensity: 2,
    transparent: true,
    opacity: 0.15,
    side: THREE.DoubleSide,
    depthWrite: false // Prevent z-fighting with other transparent objects
  });

  // Create mesh
  const cylinder = new THREE.Mesh(geometry, material);

  // Position the cylinder above the model
  cylinder.position.set(
    position.x,
    position.y + 3.2, // Position above the model
    position.z + 0.2
  );

  // Rotate to point downward
  cylinder.rotation.x = Math.PI; // Rotate 180 degrees around X axis

  // Initially invisible
  cylinder.visible = false;

  return cylinder;
}

// Load test models with sequential delays
const loadTestModels = async () => {
  try {
    // Get model configurations
    const modelConfigs = getModelConfigs();

    // Create a single text box at the top of the scene
    const topTextBox = createTextBox(['Our NSmen', 'EVER READY', 'with our lives'], {
      x: 0,
      y: 1.5, // Position at the top
      z: 0.5
    }, true);

    // Add to scene
    scene.add(topTextBox);
    topTextBox.visible = true;

    // Create a single text box at the bottom of the scene with multi-line text
    const bottomTextBox = createTextBox([
      'Our sons, brothers, fathers, spouses, co-workers, friends',
      'and neighbours—remarkable individuals bound by an',
      'unwavering commitment to answer the call of duty to',
      'defend our nation at any time'
    ], {
      x: 0,
      y: -2, // Position at the bottom, same as AR mode
      z: 0.5
    }, false);

    // Add to scene
    scene.add(bottomTextBox);
    bottomTextBox.visible = true;

    // Create an array to store spotlight cylinders
    const spotlights = [];

    // Load each enabled model
    for (const config of modelConfigs) {
      if (!config.enabled) {
        continue;
      }

      try {
        const model = await ModelManager.loadModel(config.path, {
          position: config.position,
          scale: config.scale,
          visible: config.visible,
          delay: config.delay
        });

        if (model) {
          scene.add(model.object);

          // Skip creating spotlight for dis-ball model
          if (config.path.includes('dis-ball')) {
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
        }
      } catch (error) {
        console.error(`Failed to load model ${config.path}:`, error);
        displayErrorMessage(`Failed to load ${config.path}`);
      }
    }

    // Show spotlights with the same delays as their models
    spotlights.forEach(({ spotlight, delay, modelPath }) => {
      setTimeout(() => {
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
          spotlight.visible = true;
        }, delay);
      });

      // Make sure text boxes remain visible
      if (topTextBox) topTextBox.visible = true;
      if (bottomTextBox) bottomTextBox.visible = true;
    };
  } catch (error) {
    console.error('Error loading test models:', error);
  }
};

// Initialize MindAR with target tracking
const initializeAR = async () => {
  try {
    // Check if target file exists
    try {
      const response = await fetch('targets/targets.mind', { method: 'HEAD' });
      if (!response.ok) {
        console.error('Target file does not exist or is not accessible');
        throw new Error('Target file missing');
      }
    } catch (error) {
      console.error('Error checking target file:', error);
      throw new Error('Cannot access target file');
    }

    mindarThree = new MindARThree({
      container: document.querySelector("#ar-container"),
      imageTargetSrc: 'targets/targets.mind',
      uiScanning: true, // Show scanning UI
      uiLoading: false, // We use our own loading UI
      rendererOptions: {
        antialias: true,
        alpha: true, // Enable transparency
        logarithmicDepthBuffer: true,
        outputColorSpace: THREE.SRGBColorSpace,
        sortObjects: true // Enable manual sorting of transparent objects
      },
      filterMinCF: 0.001, // Adjust tracking sensitivity
      filterBeta: 0.01,   // Adjust tracking stability
      missTolerance: 5,   // Number of frames to keep showing object when target is lost
      warmupTolerance: 5  // Number of frames to wait before showing object when target is found
    });

    const { renderer, scene, camera } = mindarThree;

    // Ensure transparent background
    renderer.setClearColor(0x000000, 0); // Set clear color with 0 alpha (fully transparent)

    const anchor = mindarThree.addAnchor(0);

    // Add lighting
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0);
    directionalLight.position.set(1, 2, 3);
    scene.add(directionalLight);

    const ambientLight = new THREE.AmbientLight(0xffffff, 1.0);
    scene.add(ambientLight);

    // Create a single text box at the top of the scene
    const topTextBox = createTextBox(['Our NSmen', 'EVER READY', 'with our lives'], {
      x: 0,
      y: 1.5, // Position at the top
      z: 3
    }, true);

    // Add to anchor group
    anchor.group.add(topTextBox);

    // Create a single text box at the bottom of the scene with multi-line text
    const bottomTextBox = createTextBox([
      'Our sons, brothers, fathers, spouses, co-workers, friends',
      'and neighbours—remarkable individuals bound by an',
      'unwavering commitment to answer the call of duty to',
      'defend our nation at any time'
    ], {
      x: 0,
      y: -1.5, // Position at the bottom, same as AR mode
      z: 3
    }, false);

    // Add to anchor group
    anchor.group.add(bottomTextBox);

    // Store references to show/hide with target tracking
    const textBoxes = [topTextBox, bottomTextBox];

    // Load models with the ModelManager
    const modelConfigs = getModelConfigs();

    // Create an array to store spotlight cylinders
    const spotlights = [];

    // Store timeout IDs for cleanup
    const timeoutIds = [];

    // Track whether animation sequence has started
    let animationSequenceStarted = false;

    for (const config of modelConfigs) {
      if (!config.enabled) {
        continue;
      }

      try {
        const model = await ModelManager.loadModel(config.path, {
          position: config.position,
          scale: config.scale,
          visible: false, // Start invisible regardless of config
          delay: config.delay
        });

        if (model) {
          // Add model to anchor group
          anchor.group.add(model.object);

          // Skip creating spotlight for dis-ball model
          if (config.path.includes('dis-ball')) {
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
        }
      } catch (error) {
        console.error(`Failed to load model ${config.path}:`, error);
        displayErrorMessage(`Failed to load ${config.path}`);
      }
    }


    // Apply transformations in the correct order: scale, rotation, position
    anchor.group.scale.set(1, 1, 1);
    anchor.group.position.set(0, 0, 0);

    // Function to start animation sequence
    const startAnimationSequence = () => {
      if (animationSequenceStarted) {
        return;
      }

      animationSequenceStarted = true;

      // Clear any existing timeouts (just in case)
      timeoutIds.forEach(id => {
        clearTimeout(id);
      });
      timeoutIds.length = 0;

      // Make sure all models are hidden initially
      Object.keys(ModelManager.models).forEach(path => {
        const model = ModelManager.models[path];
        if (model && model.object) {
          model.object.visible = false;

          // Reset animations
          if (ModelManager.actions[path]) {
            Object.keys(ModelManager.actions[path]).forEach(actionName => {
              const action = ModelManager.actions[path][actionName];
              action.paused = true;
              action.reset();
            });
          }
        }
      });

      // Hide all spotlights initially
      spotlights.forEach(({ spotlight }) => {
        spotlight.visible = false;
      });

      // Show models with their delays
      Object.keys(ModelManager.models).forEach(path => {
        const model = ModelManager.models[path];
        if (!model || !model.object) return;

        const timeoutId = setTimeout(() => {
          // Check if animation sequence is still active
          if (!animationSequenceStarted) {
            return;
          }

          model.object.visible = true;

          // Start animations when the model becomes visible
          if (ModelManager.actions[path]) {
            Object.keys(ModelManager.actions[path]).forEach(actionName => {
              const action = ModelManager.actions[path][actionName];
              action.reset();
              action.play();
              action.paused = false;
            });
          }
        }, model.options.delay);

        timeoutIds.push(timeoutId);
      });

      // Show spotlights with the same delays as their models
      spotlights.forEach(({ spotlight, delay, modelPath }) => {
        const timeoutId = setTimeout(() => {
          // Check if animation sequence is still active
          if (!animationSequenceStarted) {
            return;
          }

          spotlight.visible = true;
        }, delay);
        timeoutIds.push(timeoutId);
      });
    };

    // Function to stop animation sequence
    const stopAnimationSequence = () => {
      if (!animationSequenceStarted) return;
      animationSequenceStarted = false;

      // Clear all timeouts
      timeoutIds.forEach(id => {
        clearTimeout(id);
      });
      timeoutIds.length = 0;

      // Hide all models immediately
      Object.keys(ModelManager.models).forEach(path => {
        const model = ModelManager.models[path];
        if (model && model.object) {
          model.object.visible = false;

          // Pause and reset animations
          if (ModelManager.actions[path]) {
            Object.keys(ModelManager.actions[path]).forEach(actionName => {
              const action = ModelManager.actions[path][actionName];
              action.paused = true;
              action.reset();
            });
          }
        }
      });

      // Hide all spotlights immediately
      spotlights.forEach(({ spotlight, modelPath }) => {
        spotlight.visible = false;
      });
    };

    // Add event listeners for target found/lost
    anchor.onTargetFound = () => {
      startAnimationSequence();

      // Show text boxes
      textBoxes.forEach(textBox => {
        textBox.visible = true;
      });
    };

    anchor.onTargetLost = () => {
      stopAnimationSequence();

      // Hide text boxes
      textBoxes.forEach(textBox => {
        textBox.visible = false;
      });
    };

    // Animation loop
    renderer.setAnimationLoop(() => {
      const delta = clock.getDelta();
      ModelManager.updateAnimations(delta);

      renderer.render(scene, camera);
    });

    // Add cleanup function to mindarThree
    mindarThree.cleanup = () => {
      stopAnimationSequence();

      // Remove event listeners
      anchor.onTargetFound = null;
      anchor.onTargetLost = null;
    };

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
  try {
    // Show loading screen
    if (loadingElement) {
      loadingElement.classList.remove('hidden');
      document.querySelector('.loading-text').textContent = 'Loading...';
    }

    // Clean up any existing scene
    if (renderer) {
      renderer.dispose();
      document.getElementById('ar-container').innerHTML = '';
    }

    // Clear any existing models
    ModelManager.clearModels();

    if (testMode) {
      // Initialize test scene without AR
      const result = initTestScene();

      if (!result) {
        throw new Error('Failed to initialize test scene');
      }

      const { scene: testScene, camera: testCamera, renderer: testRenderer } = result;
      scene = testScene;
      camera = testCamera;
      renderer = testRenderer;

      // Ensure transparent background in test mode too
      renderer.setClearColor(0x000000, 0);

      await loadTestModels();
    } else {
      try {
        // Request camera permissions explicitly
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ video: true });
          // Stop the stream immediately, MindAR will request it again
          stream.getTracks().forEach(track => track.stop());
        } catch (cameraError) {
          console.error('Camera permission denied:', cameraError);
          throw new Error('Camera permission denied. Please allow camera access to use AR mode.');
        }

        // Initialize AR with target tracking
        mindarThree = await initializeAR();

        try {
          await mindarThree.start();
        } catch (startError) {
          console.error('Error starting MindAR:', startError);
          throw new Error('Failed to start camera. Please check camera permissions and try again.');
        }
      } catch (error) {
        console.error('Error in AR mode:', error);

        // Show error message
        if (loadingElement) {
          document.querySelector('.loading-text').textContent =
            `Error: ${error.message || 'Failed to initialize AR'}`;
        }

        // Ask user if they want to fall back to test mode
        if (confirm('AR mode failed. Would you like to try test mode instead?')) {
          testMode = true;

          // Try test mode
          const result = initTestScene();

          if (!result) {
            throw new Error('Failed to initialize fallback test scene');
          }

          const { scene: testScene, camera: testCamera, renderer: testRenderer } = result;
          scene = testScene;
          camera = testCamera;
          renderer = testRenderer;

          await loadTestModels();
        } else {
          // User declined fallback, rethrow error
          throw error;
        }
      }
    }

    // Hide loading screen
    if (loadingElement) {
      loadingElement.classList.add('hidden');
    }

    // Update button states
    if (startButton) startButton.disabled = true;
    if (stopButton) stopButton.disabled = false;

  } catch (error) {
    console.error('Error starting AR:', error);

    // Show error message
    if (loadingElement) {
      loadingElement.classList.add('hidden');
    }

    alert(`Error starting experience: ${error.message || 'Unknown error'}`);

    // Reset button states
    if (startButton) startButton.disabled = false;
    if (stopButton) stopButton.disabled = true;
  }
};

// Directly initialize on page load to diagnose loading issues
window.addEventListener('load', () => {
  // Check if files exist
  Promise.all([
    fetch('models/', { method: 'HEAD' }).catch(() => ({ ok: false, status: 404 })),
    fetch('targets/', { method: 'HEAD' }).catch(() => ({ ok: false, status: 404 })),
    fetch('js/main.js', { method: 'HEAD' }).catch(() => ({ ok: false, status: 404 }))
  ]);
});

// Stop AR experience
const stopAR = async () => {
  try {
    // Stop MindAR if in AR mode
    if (mindarThree && !testMode) {

      // Call cleanup function to clear timeouts and event listeners
      if (typeof mindarThree.cleanup === 'function') {
        mindarThree.cleanup();
      }

      await mindarThree.stop();
      mindarThree = null;
    }

    // Stop animation cycle
    ModelManager.stopResetCycle();

    // Clear models
    ModelManager.clearModels();

    // Clean up renderer
    if (renderer) {
      // Dispose of orbit controls if they exist
      if (orbitControls) {
        orbitControls.dispose();
        orbitControls = null;
      }

      renderer.dispose();

      // Clear the container
      const arContainer = document.getElementById('ar-container');
      if (arContainer) {
        arContainer.innerHTML = '';
      }

      renderer = null;
    }

    // Clear scene and camera references
    scene = null;
    camera = null;

    // Update button states
    if (startButton) startButton.disabled = false;
    if (stopButton) stopButton.disabled = true;

  } catch (error) {
    console.error('Error stopping AR:', error);
    alert(`Error stopping experience: ${error.message || 'Unknown error'}`);
  }
};

// Handle window resize
window.addEventListener('resize', () => {
  if (testMode && renderer) {
    // Update camera aspect ratio and renderer size
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }
  // MindAR handles resize automatically in AR mode
});

// Event listeners
if (startButton) {
  startButton.addEventListener('click', startAR);
} else {
  console.warn('Start button not found, cannot attach event listener');
}

if (stopButton) {
  stopButton.addEventListener('click', stopAR);
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
      // Store the original material for reference
      child.userData.originalMaterial = child.material;

      // Apply the new material
      child.material = warmEmissiveMaterial;
    }
  });
  return object;
}

// Create a glowy text box with multiple lines of different sizes
function createTextBox(text, position, isAbove = true) {
  // Create a group to hold all text meshes
  const textGroup = new THREE.Group();

  // Adjust background plane size based on whether it's top or bottom text
  const planeWidth = isAbove ? 2.4 : 3;
  const planeHeight = isAbove ? 1 : 0.8;

  const planeGeometry = new THREE.PlaneGeometry(planeWidth, planeHeight);
  const planeMaterial = new THREE.MeshStandardMaterial({
    color: 0xdddddd,
    transparent: true,
    opacity: 0.4,
    emissive: new THREE.Color(0xdddddd),
    emissiveIntensity: 2,
    side: THREE.DoubleSide,
    depthTest: false, // Disable depth testing to always render on top
    depthWrite: false // Don't write to depth buffer
  });

  const plane = new THREE.Mesh(planeGeometry, planeMaterial);
  textGroup.add(plane);

  // Create text using canvas
  // Create a canvas to render text
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');

  // Use fixed canvas dimensions for consistent text rendering
  canvas.width = 1024;
  canvas.height = 512;

  // Fill background with transparent color
  context.fillStyle = 'rgba(0, 0, 0, 0)';
  context.fillRect(0, 0, canvas.width, canvas.height);

  // Set text alignment
  context.textAlign = 'center';

  if (isAbove) {
    // TOP TEXT BOX - Three lines with different sizes

    // First line: "Our NSmen" - 48px Arial Black
    context.fillStyle = '#ffffff';  // White color
    context.font = '48px "Arial Black", sans-serif';
    context.fillText(text[0], canvas.width / 2, 100);

    // Second line: "EVER READY" - 72px Arial Black
    context.fillStyle = '#ffffff';  // White
    context.font = '72px "Arial Black", sans-serif';
    context.fillText(text[1], canvas.width / 2, 180);

    // Third line: "with our lives" - 48px Arial Black
    context.fillStyle = '#ffffff';  // White color
    context.font = '48px "Arial Black", sans-serif';
    if (text[2]) {
      context.fillText(text[2], canvas.width / 2, 260);
    }
  } else {
    // BOTTOM TEXT BOX - Multi-line paragraph with regular Arial
    context.fillStyle = '#ffffff';  // White color
    context.font = '32px Arial, sans-serif';  // Regular Arial, slightly smaller for more text

    // Handle multi-line text for bottom box
    const maxWidth = 800;  // Maximum width for text wrapping
    const lineHeight = 36;  // Space between lines

    // Split the text into words
    const words = text.join(' ').split(' ');
    let line = '';
    let y = 100;  // Starting y position

    // Create wrapped text
    for (let i = 0; i < words.length; i++) {
      const testLine = line + words[i] + ' ';
      const metrics = context.measureText(testLine);
      const testWidth = metrics.width;

      if (testWidth > maxWidth && i > 0) {
        context.fillText(line, canvas.width / 2, y);
        line = words[i] + ' ';
        y += lineHeight;
      } else {
        line = testLine;
      }
    }

    // Draw the last line
    context.fillText(line, canvas.width / 2, y);
  }

  // Create texture from canvas
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;

  const textMaterial = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    side: THREE.DoubleSide,
    depthTest: false, // Disable depth testing to always render on top
    depthWrite: false // Don't write to depth buffer
  });

  // Create a separate plane for the text with fixed aspect ratio
  // This ensures text doesn't get stretched regardless of background plane size
  const textAspect = canvas.width / canvas.height;
  let textPlaneWidth, textPlaneHeight;


  textPlaneWidth = planeWidth * 1;  // Slightly smaller than background
  textPlaneHeight = textPlaneWidth / textAspect;

  const textPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(textPlaneWidth, textPlaneHeight),
    textMaterial
  );
  textPlane.position.z = 0.01;
  textPlane.position.y = isAbove ? -0.2 : -0.3;
  textGroup.add(textPlane);

  // Position the text group
  textGroup.position.set(position.x, position.y, position.z);

  // Set a high renderOrder to ensure it renders on top of other objects
  textGroup.renderOrder = 999;
  plane.renderOrder = 999;
  textPlane.renderOrder = 1000;

  // Initially hide the text box
  textGroup.visible = false;

  return textGroup;
} 