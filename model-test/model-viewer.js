import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

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

// Model path
const MODEL_PATH = '../models/ARMY AR.glb';

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
  renderer.outputEncoding = THREE.sRGBEncoding;
  document.getElementById('canvas-container').appendChild(renderer.domElement);
  
  // Add orbit controls
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  
  // Add lighting
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
  scene.add(ambientLight);
  
  const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
  directionalLight.position.set(0, 5, 5);
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
    console.log('Material has diffuse map:', material.map);
    material.map.needsUpdate = true;
    material.map.encoding = THREE.sRGBEncoding;
  }
  
  // Ensure proper normal maps
  if (material.normalMap) {
    console.log('Material has normal map:', material.normalMap);
    material.normalMap.needsUpdate = true;
    material.normalScale.set(1, 1); // Reset normal scale
  }
  
  // Ensure proper material settings
  material.needsUpdate = true;
  
  return material;
}

// Fix geometry issues
function fixGeometry(geometry) {
  console.log('Checking geometry for issues:', geometry);
  
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

// Load the GLTF/GLB model
function loadModel() {
  console.log(`Loading model from: ${MODEL_PATH}`);
  
  // Check if the file exists first
  fetch(MODEL_PATH, { method: 'HEAD' })
    .then(response => {
      if (!response.ok) {
        console.error(`Model file does not exist: ${MODEL_PATH}`);
        alert(`Error: Could not find model file at ${MODEL_PATH}`);
        return;
      }
      
      console.log('Model file exists, loading...');
      
      const loader = new GLTFLoader();
      const startTime = performance.now();
      
      loader.load(
        MODEL_PATH,
        (gltf) => {
          const loadTime = performance.now() - startTime;
          console.log(`Model loaded successfully in ${loadTime.toFixed(2)}ms`);
          console.log('GLB data:', gltf);
          
          // Set the model
          model = gltf.scene;
          
          // Log model hierarchy and fix rendering issues
          console.log('Model hierarchy:');
          model.traverse(child => {
            if (child.isMesh) {
              console.log(`Mesh: ${child.name}`, {
                geometry: child.geometry,
                material: child.material,
                position: child.position,
                rotation: child.rotation,
                scale: child.scale
              });
              
              // Fix geometry issues
              if (child.geometry) {
                child.geometry = fixGeometry(child.geometry);
              }
              
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
            } else if (child.isObject3D) {
              console.log(`Object3D: ${child.name}`, {
                position: child.position,
                rotation: child.rotation,
                scale: child.scale
              });
            }
          });
          
          // Check for animations
          if (gltf.animations && gltf.animations.length > 0) {
            console.log(`Model has ${gltf.animations.length} animations:`);
            gltf.animations.forEach((animation, index) => {
              console.log(`Animation ${index}: ${animation.name}, duration: ${animation.duration}s`);
            });
            
            mixer = new THREE.AnimationMixer(model);
            animationAction = mixer.clipAction(gltf.animations[0]);
            animationAction.play();
          } else {
            console.log('Model has no animations');
          }
          
          // Set initial scale
          const initialScale = parseFloat(scaleSlider.value);
          model.scale.set(initialScale, initialScale, initialScale);
          
          // Add model to scene
          scene.add(model);
          
          // Center camera on model
          centerCameraOnModel();
        },
        (xhr) => {
          const percentComplete = Math.round((xhr.loaded / xhr.total) * 100);
          console.log(`Loading: ${percentComplete}% (${xhr.loaded}/${xhr.total} bytes)`);
        },
        (error) => {
          console.error('Error loading model:', error);
          alert(`Error loading model: ${error.message}`);
        }
      );
    })
    .catch(error => {
      console.error('Error checking if model file exists:', error);
      alert(`Error: Could not access model file at ${MODEL_PATH}`);
    });
}

// Set up event listeners
function setupEventListeners() {
  // Scale slider
  scaleSlider.addEventListener('input', (e) => {
    const value = parseFloat(e.target.value);
    scaleValue.textContent = value.toFixed(1);
    
    if (model) {
      model.scale.set(value, value, value);
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