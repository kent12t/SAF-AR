import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

// DOM elements
const scaleSlider = document.getElementById('scale');
const scaleValue = document.getElementById('scale-value');
const toggleAnimationBtn = document.getElementById('toggle-animation');
const toggleWireframeBtn = document.getElementById('toggle-wireframe');
const resetCameraBtn = document.getElementById('reset-camera');

// Three.js variables
let scene, camera, renderer, controls;
let model, mixer, clock;
let animationAction = null;
let isPlaying = true;
let isWireframe = false;

// Model path - change this to load a different model
const MODEL_PATH = '../models/rsaf.glb'; // Can be .glb, .gltf, or .fbx

// Initialize Three.js scene
function init() {
  console.log('Initializing Three.js scene...');
  
  // Create scene
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x444444);
  
  // Create camera
  camera = new THREE.PerspectiveCamera(
    75, 
    window.innerWidth / window.innerHeight, 
    0.1, 
    1000
  );
  camera.position.z = 5;
  
  // Create renderer
  renderer = new THREE.WebGLRenderer({ 
    antialias: true,
    logarithmicDepthBuffer: true // Help with z-fighting issues
  });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  document.getElementById('canvas-container').appendChild(renderer.domElement);
  
  // Add orbit controls
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  
  // Add lighting
  const ambientLight = new THREE.AmbientLight(0xffffff, 1.0);
  scene.add(ambientLight);
  
  const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0);
  directionalLight.position.set(1, 2, 3);
  scene.add(directionalLight);
  
  // Add a grid helper
  const gridHelper = new THREE.GridHelper(10, 10);
  scene.add(gridHelper);
  
  // Setup clock for animations
  clock = new THREE.Clock();
  
  // Load the model
  loadModel();
  
  // Add event listeners
  setupEventListeners();
  
  // Start animation loop
  animate();
  
  console.log('Three.js scene initialized');
}

// Fix material issues
function fixMaterial(material) {
  console.log('Fixing material:', material);
  
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

// Display error message in the scene
function displayErrorMessage(message) {
  // Create a canvas texture with the error message
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = '24px Arial';
  ctx.fillStyle = 'white';
  ctx.textAlign = 'center';
  ctx.fillText('Error Loading Model:', canvas.width/2, 100);
  ctx.fillText(message, canvas.width/2, 140);
  ctx.fillText('Check console for details', canvas.width/2, 180);
  
  // Create a plane to display the message
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

// Load the model (GLB/GLTF or FBX)
function loadModel() {
  console.log(`Loading model from: ${MODEL_PATH}`);
  
  // Determine file type
  const isGLB = MODEL_PATH.toLowerCase().endsWith('.glb') || MODEL_PATH.toLowerCase().endsWith('.gltf');
  const isFBX = MODEL_PATH.toLowerCase().endsWith('.fbx');
  
  if (!isGLB && !isFBX) {
    console.error('Unsupported model format. Only GLB/GLTF and FBX are supported.');
    displayErrorMessage('Unsupported model format');
    return;
  }
  
  // Check if the file exists first
  fetch(MODEL_PATH, { method: 'HEAD' })
    .then(response => {
      if (!response.ok) {
        console.error(`Model file does not exist: ${MODEL_PATH}`);
        displayErrorMessage(`File not found: ${MODEL_PATH}`);
        return;
      }
      
      console.log('Model file exists, loading...');
      
      // Choose the appropriate loader based on file extension
      const loader = isGLB ? new GLTFLoader() : new FBXLoader();
      const startTime = performance.now();
      
      loader.load(
        MODEL_PATH,
        (result) => {
          const loadTime = performance.now() - startTime;
          console.log(`Model loaded successfully in ${loadTime.toFixed(2)}ms`);
          
          // Set the model (different for GLB vs FBX)
          if (isGLB) {
            model = result.scene;
          } else {
            model = result; // FBX loader returns the model directly
          }
          
          // Log model hierarchy and fix rendering issues
          console.log('Model hierarchy:');
          model.traverse(child => {
            if (child.isMesh) {
              console.log(`Mesh: ${child.name}`);
              
              // Fix geometry issues
              // if (child.geometry) {
              //   child.geometry = fixGeometry(child.geometry);
              // }
              
              // Fix material issues
              if (child.material) {
                if (Array.isArray(child.material)) {
                  console.log(`Mesh ${child.name} has ${child.material.length} materials`);
                  child.material = child.material.map(mat => fixMaterial(mat));
                } else {
                  child.material = fixMaterial(child.material);
                }
              }
              
              // Ensure proper rendering settings
              child.frustumCulled = false; // Prevent culling issues
              child.renderOrder = 0; // Default render order
              
              // Ensure the mesh casts and receives shadows properly
              child.castShadow = true;
              child.receiveShadow = true;
            }
          });
          
          // Handle animations (different for GLB vs FBX)
          mixer = new THREE.AnimationMixer(model);
          const animations = isGLB ? result.animations : model.animations;
          
          if (animations && animations.length > 0) {
            console.log(`Model has ${animations.length} animations:`);
            animations.forEach((animation, index) => {
              console.log(`Animation ${index}: ${animation.name || 'unnamed'}, duration: ${animation.duration}s`);
            });
            
            animationAction = mixer.clipAction(animations[0]);
            animationAction.play();
          } else {
            console.log('Model has no animations');
            animationAction = null;
          }
          
          // Set initial scale - FBX models typically need to be scaled down
          const initialScale = parseFloat(scaleSlider.value);
          if (isFBX) {
            // FBX models often need to be scaled down
            model.scale.set(initialScale * 0.01, initialScale * 0.01, initialScale * 0.01);
            console.log('Applied FBX scale factor');
          } else {
            model.scale.set(initialScale, initialScale, initialScale);
          }
          
          // Add model to scene
          scene.add(model);
          
          // Center camera on model
          centerCameraOnModel();
          
          // Update UI
          if (toggleAnimationBtn) {
            toggleAnimationBtn.disabled = !animations || animations.length === 0;
            toggleAnimationBtn.textContent = 'Pause Animation';
          }
        },
        (xhr) => {
          const percentComplete = Math.round((xhr.loaded / xhr.total) * 100);
          console.log(`Loading: ${percentComplete}% (${xhr.loaded}/${xhr.total} bytes)`);
        },
        (error) => {
          console.error('Error loading model:', error);
          displayErrorMessage(error.message || 'Unknown error');
        }
      );
    })
    .catch(error => {
      console.error('Error checking if model file exists:', error);
      displayErrorMessage('Network error checking file');
    });
}

// Set up event listeners
function setupEventListeners() {
  // Scale slider
  scaleSlider.addEventListener('input', (e) => {
    const value = parseFloat(e.target.value);
    scaleValue.textContent = value.toFixed(1);
    
    if (model) {
      // Check if it's an FBX model (smaller scale factor)
      const isFBX = MODEL_PATH.toLowerCase().endsWith('.fbx');
      const scaleFactor = isFBX ? 0.01 : 1.0;
      
      model.scale.set(
        value * scaleFactor, 
        value * scaleFactor, 
        value * scaleFactor
      );
    }
  });
  
  // Toggle animation
  toggleAnimationBtn.addEventListener('click', () => {
    if (!mixer || !animationAction) {
      console.log('No animation to toggle');
      return;
    }
    
    isPlaying = !isPlaying;
    toggleAnimationBtn.textContent = isPlaying ? 'Pause Animation' : 'Play Animation';
    
    if (isPlaying) {
      animationAction.paused = false;
    } else {
      animationAction.paused = true;
    }
  });
  
  // Toggle wireframe
  toggleWireframeBtn.addEventListener('click', () => {
    if (!model) return;
    
    isWireframe = !isWireframe;
    toggleWireframeBtn.textContent = isWireframe ? 'Show Textured' : 'Show Wireframe';
    
    model.traverse(child => {
      if (child.isMesh && child.material) {
        if (Array.isArray(child.material)) {
          child.material.forEach(mat => mat.wireframe = isWireframe);
        } else {
          child.material.wireframe = isWireframe;
        }
      }
    });
  });
  
  // Reset camera
  resetCameraBtn.addEventListener('click', () => {
    centerCameraOnModel();
  });
  
  // Handle window resize
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

// Center camera on model
function centerCameraOnModel() {
  if (!model) return;
  
  // Create a bounding box for the model
  const boundingBox = new THREE.Box3().setFromObject(model);
  const center = boundingBox.getCenter(new THREE.Vector3());
  const size = boundingBox.getSize(new THREE.Vector3());
  
  // Get the maximum dimension of the model
  const maxDim = Math.max(size.x, size.y, size.z);
  const fov = camera.fov * (Math.PI / 180);
  let cameraDistance = Math.abs(maxDim / Math.sin(fov / 2));
  
  // Set minimum distance
  cameraDistance = Math.max(cameraDistance, 2);
  
  // Set camera position
  camera.position.set(center.x, center.y, center.z + cameraDistance);
  camera.lookAt(center);
  
  // Update orbit controls
  controls.target.copy(center);
  controls.update();
  
  console.log('Camera centered on model', {
    modelCenter: center,
    modelSize: size,
    cameraDistance: cameraDistance,
    cameraPosition: camera.position.clone()
  });
}

// Animation loop
function animate() {
  requestAnimationFrame(animate);
  
  // Update controls
  controls.update();
  
  // Update animation mixer if it exists
  if (mixer) {
    mixer.update(clock.getDelta());
  }
  
  // Render the scene
  renderer.render(scene, camera);
}

// Initialize the application
init(); 