

'use strict';

// Simulation section

const canvas = document.getElementsByTagName('canvas')[0];
resizeCanvas();

let config = {
    SIM_RESOLUTION: 128,
    DYE_RESOLUTION: 1024,
    CAPTURE_RESOLUTION: 512,
    DENSITY_DISSIPATION: 0.2,
    VELOCITY_DISSIPATION: 2.5,
    PRESSURE: 0.8,
    PRESSURE_ITERATIONS: 20,
    CURL: 1.5,
    SPLAT_RADIUS: 0.4,
    SPLAT_FORCE: 1200,
    SHADING: true,
    COLORFUL: true,
    COLOR_UPDATE_SPEED: 3,
    PAUSED: false,
    BACK_COLOR: { r: 255, g: 255, b: 255 },
    TRANSPARENT: false,
    BLOOM: false,
    BLOOM_ITERATIONS: 8,
    BLOOM_RESOLUTION: 256,
    BLOOM_INTENSITY: 0.15,
    BLOOM_THRESHOLD: 0.5,
    BLOOM_SOFT_KNEE: 0.7,
    SUNRAYS: false,
    SUNRAYS_RESOLUTION: 196,
    SUNRAYS_WEIGHT: 1.0,
    COLOR_SATURATION: 0.55,
    COLOR_VALUE: 0.65,
    COLOR_MULTIPLIER: 0.35,
    POSTERIZE: true,
    POSTERIZE_LEVELS: 5,
    EDGE_STRENGTH: 0.45,
    USE_PALETTE: false,
    PALETTE: ['#8ecae6', '#ffb4a2'],
}

function pointerPrototype () {
    this.id = -1;
    this.texcoordX = 0;
    this.texcoordY = 0;
    this.prevTexcoordX = 0;
    this.prevTexcoordY = 0;
    this.deltaX = 0;
    this.deltaY = 0;
    this.down = false;
    this.moved = false;
    this.color = [30, 0, 300];
}

let pointers = [];
let splatStack = [];
pointers.push(new pointerPrototype());

const { gl, ext } = getWebGLContext(canvas);

if (isMobile()) {
    config.DYE_RESOLUTION = 512;
}
if (!ext.supportLinearFiltering) {
    config.DYE_RESOLUTION = 512;
    config.SHADING = false;
    config.BLOOM = false;
    config.SUNRAYS = false;
}

startGUI();

function getWebGLContext (canvas) {
    const params = { alpha: true, depth: false, stencil: false, antialias: false, preserveDrawingBuffer: false };

    let gl = canvas.getContext('webgl2', params);
    const isWebGL2 = !!gl;
    if (!isWebGL2)
        gl = canvas.getContext('webgl', params) || canvas.getContext('experimental-webgl', params);

    let halfFloat;
    let supportLinearFiltering;
    if (isWebGL2) {
        gl.getExtension('EXT_color_buffer_float');
        supportLinearFiltering = gl.getExtension('OES_texture_float_linear');
    } else {
        halfFloat = gl.getExtension('OES_texture_half_float');
        supportLinearFiltering = gl.getExtension('OES_texture_half_float_linear');
    }

    gl.clearColor(0.0, 0.0, 0.0, 1.0);

    const halfFloatTexType = isWebGL2 ? gl.HALF_FLOAT : halfFloat.HALF_FLOAT_OES;
    let formatRGBA;
    let formatRG;
    let formatR;

    if (isWebGL2)
    {
        formatRGBA = getSupportedFormat(gl, gl.RGBA16F, gl.RGBA, halfFloatTexType);
        formatRG = getSupportedFormat(gl, gl.RG16F, gl.RG, halfFloatTexType);
        formatR = getSupportedFormat(gl, gl.R16F, gl.RED, halfFloatTexType);
    }
    else
    {
        formatRGBA = getSupportedFormat(gl, gl.RGBA, gl.RGBA, halfFloatTexType);
        formatRG = getSupportedFormat(gl, gl.RGBA, gl.RGBA, halfFloatTexType);
        formatR = getSupportedFormat(gl, gl.RGBA, gl.RGBA, halfFloatTexType);
    }

    ga('send', 'event', isWebGL2 ? 'webgl2' : 'webgl', formatRGBA == null ? 'not supported' : 'supported');

    return {
        gl,
        ext: {
            formatRGBA,
            formatRG,
            formatR,
            halfFloatTexType,
            supportLinearFiltering
        }
    };
}

function getSupportedFormat (gl, internalFormat, format, type)
{
    if (!supportRenderTextureFormat(gl, internalFormat, format, type))
    {
        switch (internalFormat)
        {
            case gl.R16F:
                return getSupportedFormat(gl, gl.RG16F, gl.RG, type);
            case gl.RG16F:
                return getSupportedFormat(gl, gl.RGBA16F, gl.RGBA, type);
            default:
                return null;
        }
    }

    return {
        internalFormat,
        format
    }
}

function supportRenderTextureFormat (gl, internalFormat, format, type) {
    let texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, 4, 4, 0, format, type, null);

    let fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);

    let status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    return status == gl.FRAMEBUFFER_COMPLETE;
}

function startGUI () {
    var gui = new dat.GUI({ width: 280 });

    function refreshGUIDisplay (folder) {
        folder.__controllers.forEach(c => c.updateDisplay());
        for (let key in folder.__folders) refreshGUIDisplay(folder.__folders[key]);
    }

    // ============================
    // PAINT — friendly, intuitive controls
    // ============================
    let paintFolder = gui.addFolder('Paint');
    paintFolder.open();

    let paintControls = {
        get wetness () {
            return Math.max(0, Math.min(1, (1 - config.DENSITY_DISSIPATION) / 0.98));
        },
        set wetness (v) {
            config.DENSITY_DISSIPATION = 1 - v * 0.98;
        },
    };

    paintFolder.add(paintControls, 'wetness', 0, 1).name('wetness');
    paintFolder.add(config, 'SPLAT_RADIUS', 0.1, 1.0).name('thickness');
    paintFolder.add(config, 'CURL', 0, 20).step(0.5).name('swirl');
    paintFolder.add(config, 'SPLAT_FORCE', 300, 4000).name('force');
    paintFolder.add(config, 'VELOCITY_DISSIPATION', 0.2, 4.0).name('settle speed');
    paintFolder.add({ fun: clearCanvas }, 'fun').name('Clear canvas');

    let pigmentFolder = gui.addFolder('Pigment');
    pigmentFolder.add(config, 'COLOR_SATURATION', 0, 1).name('saturation');
    pigmentFolder.add(config, 'COLOR_VALUE', 0, 1).name('brightness');
    pigmentFolder.add(config, 'COLOR_MULTIPLIER', 0.05, 0.6).name('intensity');

    let illustrationFolder = gui.addFolder('Illustration');
    illustrationFolder.add(config, 'POSTERIZE').name('flat colour cells').onFinishChange(updateKeywords);
    illustrationFolder.add(config, 'POSTERIZE_LEVELS', 2, 12).step(1).name('colour bands');
    illustrationFolder.add(config, 'EDGE_STRENGTH', 0, 1).name('paper edges');

    let effectsFolder = gui.addFolder('Effects');
    window.__pitchAware = false;
    effectsFolder.add(window, '__pitchAware').name('pitch colour mode');
    effectsFolder.add({ fun: () => {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(() => {});
        } else {
            document.exitFullscreen().catch(() => {});
        }
    } }, 'fun').name('toggle fullscreen');

    let captureFolder = gui.addFolder('Capture');
    captureFolder.addColor(config, 'BACK_COLOR').name('background color');
    captureFolder.add(config, 'TRANSPARENT').name('transparent');
    captureFolder.add({ fun: captureScreenshot }, 'fun').name('take screenshot');

    // ============================
    // ADVANCED — raw simulation controls (power users)
    // ============================
    let advancedFolder = gui.addFolder('Advanced');
    advancedFolder.add(config, 'DYE_RESOLUTION', { 'high': 1024, 'medium': 512, 'low': 256, 'very low': 128 }).name('quality').onFinishChange(initFramebuffers);
    advancedFolder.add(config, 'SIM_RESOLUTION', { '32': 32, '64': 64, '128': 128, '256': 256 }).name('sim resolution').onFinishChange(initFramebuffers);
    advancedFolder.add(config, 'PRESSURE', 0.0, 1.0).name('pressure');
    advancedFolder.add(config, 'SHADING').name('shading').onFinishChange(updateKeywords);
    advancedFolder.add(config, 'COLORFUL').name('colorful');
    advancedFolder.add(config, 'PAUSED').name('paused').listen();
    advancedFolder.add({ fun: () => {
        splatStack.push(parseInt(Math.random() * 20) + 5);
    } }, 'fun').name('Random splats');

    let bloomFolder = advancedFolder.addFolder('Bloom');
    bloomFolder.add(config, 'BLOOM').name('enabled').onFinishChange(updateKeywords);
    bloomFolder.add(config, 'BLOOM_INTENSITY', 0.1, 2.0).name('intensity');
    bloomFolder.add(config, 'BLOOM_THRESHOLD', 0.0, 1.0).name('threshold');

    let sunraysFolder = advancedFolder.addFolder('Sunrays');
    sunraysFolder.add(config, 'SUNRAYS').name('enabled').onFinishChange(updateKeywords);
    sunraysFolder.add(config, 'SUNRAYS_WEIGHT', 0.3, 1.0).name('weight');

    // ============================
    // PRESETS (placed last so the folder sits at the bottom)
    // ============================
    let presetsFolder = gui.addFolder('Presets');
    presetsFolder.open();

    function applyPreset (p) {
        Object.assign(config, p);
        updateKeywords();
        initFramebuffers();
        refreshGUIDisplay(gui);
    }

    function addPresetButton (label, snapshot, presetName) {
        let ctrl = presetsFolder.add({ fun: () => applyPreset(snapshot) }, 'fun').name(label);
        ctrl.__li.style.position = 'relative';

        let delBtn = document.createElement('span');
        delBtn.textContent = '✕';
        delBtn.className = 'preset-delete';
        delBtn.title = 'Delete preset';
        delBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!confirm('Delete preset "' + presetName + '"?')) return;
            let saved = JSON.parse(localStorage.getItem('fluidPresets') || '[]');
            saved = saved.filter(p => p.name !== presetName);
            localStorage.setItem('fluidPresets', JSON.stringify(saved));
            ctrl.__li.remove();
            presetsFolder.__controllers = presetsFolder.__controllers.filter(c => c !== ctrl);
        });
        ctrl.__li.appendChild(delBtn);
        return ctrl;
    }

    function snapshotConfig () {
        return {
            BACK_COLOR: { r: config.BACK_COLOR.r, g: config.BACK_COLOR.g, b: config.BACK_COLOR.b },
            DENSITY_DISSIPATION: config.DENSITY_DISSIPATION,
            VELOCITY_DISSIPATION: config.VELOCITY_DISSIPATION,
            PRESSURE: config.PRESSURE,
            CURL: config.CURL,
            SPLAT_RADIUS: config.SPLAT_RADIUS,
            SPLAT_FORCE: config.SPLAT_FORCE,
            BLOOM: config.BLOOM,
            BLOOM_INTENSITY: config.BLOOM_INTENSITY,
            BLOOM_THRESHOLD: config.BLOOM_THRESHOLD,
            SUNRAYS: config.SUNRAYS,
            SUNRAYS_WEIGHT: config.SUNRAYS_WEIGHT,
            COLOR_SATURATION: config.COLOR_SATURATION,
            COLOR_VALUE: config.COLOR_VALUE,
            COLOR_MULTIPLIER: config.COLOR_MULTIPLIER,
            POSTERIZE: config.POSTERIZE,
            POSTERIZE_LEVELS: config.POSTERIZE_LEVELS,
            EDGE_STRENGTH: config.EDGE_STRENGTH,
            USE_PALETTE: config.USE_PALETTE,
        };
    }

    presetsFolder.add({ fun: () => {
        const name = prompt('Name this preset:');
        if (!name) return;
        const snapshot = snapshotConfig();
        const saved = JSON.parse(localStorage.getItem('fluidPresets') || '[]');
        saved.push({ name, config: snapshot });
        localStorage.setItem('fluidPresets', JSON.stringify(saved));
        addPresetButton(name, snapshot, name);
    } }, 'fun').name('+ Save current as preset');

    const DEFAULT_PRESETS = [
        { name: 'Midnight Ink', config: {
            BACK_COLOR: { r: 0, g: 0, b: 0 },
            BLOOM: true, BLOOM_INTENSITY: 0.5, BLOOM_THRESHOLD: 0.4,
            SUNRAYS: true, SUNRAYS_WEIGHT: 0.8,
            CURL: 15, SPLAT_RADIUS: 0.3, SPLAT_FORCE: 1500,
            DENSITY_DISSIPATION: 0.3, VELOCITY_DISSIPATION: 2,
            COLOR_SATURATION: 0.45, COLOR_VALUE: 0.9, COLOR_MULTIPLIER: 0.15,
            POSTERIZE: false, POSTERIZE_LEVELS: 5, EDGE_STRENGTH: 0.45,
            USE_PALETTE: false,
        }},
        { name: 'Paper Watercolour', config: {
            BACK_COLOR: { r: 255, g: 255, b: 255 },
            BLOOM: false, BLOOM_INTENSITY: 0.15, BLOOM_THRESHOLD: 0.5,
            SUNRAYS: false, SUNRAYS_WEIGHT: 1.0,
            CURL: 1.5, SPLAT_RADIUS: 0.4, SPLAT_FORCE: 1200,
            DENSITY_DISSIPATION: 0.2, VELOCITY_DISSIPATION: 2.5,
            COLOR_SATURATION: 0.55, COLOR_VALUE: 0.65, COLOR_MULTIPLIER: 0.35,
            POSTERIZE: true, POSTERIZE_LEVELS: 5, EDGE_STRENGTH: 0.45,
            USE_PALETTE: false,
        }},
    ];

    let savedPresets = JSON.parse(localStorage.getItem('fluidPresets') || 'null');
    if (savedPresets === null) {
        savedPresets = DEFAULT_PRESETS;
        localStorage.setItem('fluidPresets', JSON.stringify(savedPresets));
    }
    savedPresets.forEach(p => addPresetButton(p.name, p.config, p.name));

    // ── accordion behaviour: opening one top-level folder closes the others ──
    const topFolders = [paintFolder, pigmentFolder, illustrationFolder, effectsFolder, captureFolder, advancedFolder, presetsFolder];
    topFolders.forEach(folder => {
        const titleEl = folder.domElement.querySelector('.title');
        if (!titleEl) return;
        titleEl.addEventListener('click', () => {
            // after dat.gui's own toggle runs, close all the others
            setTimeout(() => {
                const justOpened = !folder.closed;
                if (justOpened) {
                    topFolders.forEach(f => {
                        if (f !== folder && !f.closed) f.close();
                    });
                }
            }, 0);
        });
    });

    let creditCtrl = gui.add({ fun: () => {
        window.open('https://www.instagram.com/divakoreee/', '_blank');
    } }, 'fun').name('created by divakar');
    creditCtrl.__li.style.opacity = '0.55';
    creditCtrl.__li.style.fontStyle = 'italic';

    gui.domElement.style.display = 'none';
    window.__fluidGUI = gui;
}

function isMobile () {
    return /Mobi|Android/i.test(navigator.userAgent);
}

function captureScreenshot () {
    let res = getResolution(config.CAPTURE_RESOLUTION);
    let target = createFBO(res.width, res.height, ext.formatRGBA.internalFormat, ext.formatRGBA.format, ext.halfFloatTexType, gl.NEAREST);
    render(target);

    let texture = framebufferToTexture(target);
    texture = normalizeTexture(texture, target.width, target.height);

    let captureCanvas = textureToCanvas(texture, target.width, target.height);
    let datauri = captureCanvas.toDataURL();
    downloadURI('fluid.png', datauri);
    URL.revokeObjectURL(datauri);
}

function framebufferToTexture (target) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    let length = target.width * target.height * 4;
    let texture = new Float32Array(length);
    gl.readPixels(0, 0, target.width, target.height, gl.RGBA, gl.FLOAT, texture);
    return texture;
}

function normalizeTexture (texture, width, height) {
    let result = new Uint8Array(texture.length);
    let id = 0;
    for (let i = height - 1; i >= 0; i--) {
        for (let j = 0; j < width; j++) {
            let nid = i * width * 4 + j * 4;
            result[nid + 0] = clamp01(texture[id + 0]) * 255;
            result[nid + 1] = clamp01(texture[id + 1]) * 255;
            result[nid + 2] = clamp01(texture[id + 2]) * 255;
            result[nid + 3] = clamp01(texture[id + 3]) * 255;
            id += 4;
        }
    }
    return result;
}

function clamp01 (input) {
    return Math.min(Math.max(input, 0), 1);
}

function textureToCanvas (texture, width, height) {
    let captureCanvas = document.createElement('canvas');
    let ctx = captureCanvas.getContext('2d');
    captureCanvas.width = width;
    captureCanvas.height = height;

    let imageData = ctx.createImageData(width, height);
    imageData.data.set(texture);
    ctx.putImageData(imageData, 0, 0);

    return captureCanvas;
}

function downloadURI (filename, uri) {
    let link = document.createElement('a');
    link.download = filename;
    link.href = uri;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

class Material {
    constructor (vertexShader, fragmentShaderSource) {
        this.vertexShader = vertexShader;
        this.fragmentShaderSource = fragmentShaderSource;
        this.programs = [];
        this.activeProgram = null;
        this.uniforms = [];
    }

    setKeywords (keywords) {
        let hash = 0;
        for (let i = 0; i < keywords.length; i++)
            hash += hashCode(keywords[i]);

        let program = this.programs[hash];
        if (program == null)
        {
            let fragmentShader = compileShader(gl.FRAGMENT_SHADER, this.fragmentShaderSource, keywords);
            program = createProgram(this.vertexShader, fragmentShader);
            this.programs[hash] = program;
        }

        if (program == this.activeProgram) return;

        this.uniforms = getUniforms(program);
        this.activeProgram = program;
    }

    bind () {
        gl.useProgram(this.activeProgram);
    }
}

class Program {
    constructor (vertexShader, fragmentShader) {
        this.uniforms = {};
        this.program = createProgram(vertexShader, fragmentShader);
        this.uniforms = getUniforms(this.program);
    }

    bind () {
        gl.useProgram(this.program);
    }
}

function createProgram (vertexShader, fragmentShader) {
    let program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
        console.trace(gl.getProgramInfoLog(program));

    return program;
}

function getUniforms (program) {
    let uniforms = [];
    let uniformCount = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < uniformCount; i++) {
        let uniformName = gl.getActiveUniform(program, i).name;
        uniforms[uniformName] = gl.getUniformLocation(program, uniformName);
    }
    return uniforms;
}

function compileShader (type, source, keywords) {
    source = addKeywords(source, keywords);

    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
        console.trace(gl.getShaderInfoLog(shader));

    return shader;
};

function addKeywords (source, keywords) {
    if (keywords == null) return source;
    let keywordsString = '';
    keywords.forEach(keyword => {
        keywordsString += '#define ' + keyword + '\n';
    });
    return keywordsString + source;
}

const baseVertexShader = compileShader(gl.VERTEX_SHADER, `
    precision highp float;

    attribute vec2 aPosition;
    varying vec2 vUv;
    varying vec2 vL;
    varying vec2 vR;
    varying vec2 vT;
    varying vec2 vB;
    uniform vec2 texelSize;

    void main () {
        vUv = aPosition * 0.5 + 0.5;
        vL = vUv - vec2(texelSize.x, 0.0);
        vR = vUv + vec2(texelSize.x, 0.0);
        vT = vUv + vec2(0.0, texelSize.y);
        vB = vUv - vec2(0.0, texelSize.y);
        gl_Position = vec4(aPosition, 0.0, 1.0);
    }
`);

const blurVertexShader = compileShader(gl.VERTEX_SHADER, `
    precision highp float;

    attribute vec2 aPosition;
    varying vec2 vUv;
    varying vec2 vL;
    varying vec2 vR;
    uniform vec2 texelSize;

    void main () {
        vUv = aPosition * 0.5 + 0.5;
        float offset = 1.33333333;
        vL = vUv - texelSize * offset;
        vR = vUv + texelSize * offset;
        gl_Position = vec4(aPosition, 0.0, 1.0);
    }
`);

const blurShader = compileShader(gl.FRAGMENT_SHADER, `
    precision mediump float;
    precision mediump sampler2D;

    varying vec2 vUv;
    varying vec2 vL;
    varying vec2 vR;
    uniform sampler2D uTexture;

    void main () {
        vec4 sum = texture2D(uTexture, vUv) * 0.29411764;
        sum += texture2D(uTexture, vL) * 0.35294117;
        sum += texture2D(uTexture, vR) * 0.35294117;
        gl_FragColor = sum;
    }
`);

const copyShader = compileShader(gl.FRAGMENT_SHADER, `
    precision mediump float;
    precision mediump sampler2D;

    varying highp vec2 vUv;
    uniform sampler2D uTexture;

    void main () {
        gl_FragColor = texture2D(uTexture, vUv);
    }
`);

const clearShader = compileShader(gl.FRAGMENT_SHADER, `
    precision mediump float;
    precision mediump sampler2D;

    varying highp vec2 vUv;
    uniform sampler2D uTexture;
    uniform float value;

    void main () {
        gl_FragColor = value * texture2D(uTexture, vUv);
    }
`);

const colorShader = compileShader(gl.FRAGMENT_SHADER, `
    precision mediump float;

    uniform vec4 color;

    void main () {
        gl_FragColor = color;
    }
`);

const checkerboardShader = compileShader(gl.FRAGMENT_SHADER, `
    precision highp float;
    precision highp sampler2D;

    varying vec2 vUv;
    uniform sampler2D uTexture;
    uniform float aspectRatio;

    #define SCALE 25.0

    void main () {
        vec2 uv = floor(vUv * SCALE * vec2(aspectRatio, 1.0));
        float v = mod(uv.x + uv.y, 2.0);
        v = v * 0.1 + 0.8;
        gl_FragColor = vec4(vec3(v), 1.0);
    }
`);

const displayShaderSource = `
    precision highp float;
    precision highp sampler2D;

    varying vec2 vUv;
    varying vec2 vL;
    varying vec2 vR;
    varying vec2 vT;
    varying vec2 vB;
    uniform sampler2D uTexture;
    uniform sampler2D uBloom;
    uniform sampler2D uSunrays;
    uniform sampler2D uDithering;
    uniform vec2 ditherScale;
    uniform vec2 texelSize;
    uniform vec3 uBackColor;
    uniform float uPosterizeLevels;
    uniform float uEdgeStrength;

    vec3 linearToGamma (vec3 color) {
        color = max(color, vec3(0));
        return max(1.055 * pow(color, vec3(0.416666667)) - 0.055, vec3(0));
    }

    void main () {
        vec3 c = texture2D(uTexture, vUv).rgb;

    #if defined(SHADING) || defined(POSTERIZE)
        vec3 lc = texture2D(uTexture, vL).rgb;
        vec3 rc = texture2D(uTexture, vR).rgb;
        vec3 tc = texture2D(uTexture, vT).rgb;
        vec3 bc = texture2D(uTexture, vB).rgb;
    #endif

    #ifdef SHADING
        float dx = length(rc) - length(lc);
        float dy = length(tc) - length(bc);

        vec3 n = normalize(vec3(dx, dy, length(texelSize)));
        vec3 l = vec3(0.0, 0.0, 1.0);

        float diffuse = clamp(dot(n, l) + 0.7, 0.7, 1.0);
        c *= diffuse;
    #endif

    #ifdef BLOOM
        vec3 bloom = texture2D(uBloom, vUv).rgb;
    #endif

    #ifdef SUNRAYS
        float sunrays = texture2D(uSunrays, vUv).r;
        c *= sunrays;
    #ifdef BLOOM
        bloom *= sunrays;
    #endif
    #endif

    #ifdef BLOOM
        float noise = texture2D(uDithering, vUv * ditherScale).r;
        noise = noise * 2.0 - 1.0;
        bloom += noise / 255.0;
        bloom = linearToGamma(bloom);
        c += bloom;
    #endif

    #ifdef POSTERIZE
        c = floor(c * uPosterizeLevels + 0.5) / uPosterizeLevels;

        float edge = length(rc - lc) + length(tc - bc);
        edge = smoothstep(0.25, 0.6, edge);
        c = mix(c, uBackColor, edge * uEdgeStrength * 0.6);
    #endif

        float a = max(c.r, max(c.g, c.b));
        gl_FragColor = vec4(c, a);
    }
`;

const bloomPrefilterShader = compileShader(gl.FRAGMENT_SHADER, `
    precision mediump float;
    precision mediump sampler2D;

    varying vec2 vUv;
    uniform sampler2D uTexture;
    uniform vec3 curve;
    uniform float threshold;

    void main () {
        vec3 c = texture2D(uTexture, vUv).rgb;
        float br = max(c.r, max(c.g, c.b));
        float rq = clamp(br - curve.x, 0.0, curve.y);
        rq = curve.z * rq * rq;
        c *= max(rq, br - threshold) / max(br, 0.0001);
        gl_FragColor = vec4(c, 0.0);
    }
`);

const bloomBlurShader = compileShader(gl.FRAGMENT_SHADER, `
    precision mediump float;
    precision mediump sampler2D;

    varying vec2 vL;
    varying vec2 vR;
    varying vec2 vT;
    varying vec2 vB;
    uniform sampler2D uTexture;

    void main () {
        vec4 sum = vec4(0.0);
        sum += texture2D(uTexture, vL);
        sum += texture2D(uTexture, vR);
        sum += texture2D(uTexture, vT);
        sum += texture2D(uTexture, vB);
        sum *= 0.25;
        gl_FragColor = sum;
    }
`);

const bloomFinalShader = compileShader(gl.FRAGMENT_SHADER, `
    precision mediump float;
    precision mediump sampler2D;

    varying vec2 vL;
    varying vec2 vR;
    varying vec2 vT;
    varying vec2 vB;
    uniform sampler2D uTexture;
    uniform float intensity;

    void main () {
        vec4 sum = vec4(0.0);
        sum += texture2D(uTexture, vL);
        sum += texture2D(uTexture, vR);
        sum += texture2D(uTexture, vT);
        sum += texture2D(uTexture, vB);
        sum *= 0.25;
        gl_FragColor = sum * intensity;
    }
`);

const sunraysMaskShader = compileShader(gl.FRAGMENT_SHADER, `
    precision highp float;
    precision highp sampler2D;

    varying vec2 vUv;
    uniform sampler2D uTexture;

    void main () {
        vec4 c = texture2D(uTexture, vUv);
        float br = max(c.r, max(c.g, c.b));
        c.a = 1.0 - min(max(br * 20.0, 0.0), 0.8);
        gl_FragColor = c;
    }
`);

const sunraysShader = compileShader(gl.FRAGMENT_SHADER, `
    precision highp float;
    precision highp sampler2D;

    varying vec2 vUv;
    uniform sampler2D uTexture;
    uniform float weight;

    #define ITERATIONS 16

    void main () {
        float Density = 0.3;
        float Decay = 0.95;
        float Exposure = 0.7;

        vec2 coord = vUv;
        vec2 dir = vUv - 0.5;

        dir *= 1.0 / float(ITERATIONS) * Density;
        float illuminationDecay = 1.0;

        float color = texture2D(uTexture, vUv).a;

        for (int i = 0; i < ITERATIONS; i++)
        {
            coord -= dir;
            float col = texture2D(uTexture, coord).a;
            color += col * illuminationDecay * weight;
            illuminationDecay *= Decay;
        }

        gl_FragColor = vec4(color * Exposure, 0.0, 0.0, 1.0);
    }
`);

const splatShader = compileShader(gl.FRAGMENT_SHADER, `
    precision highp float;
    precision highp sampler2D;

    varying vec2 vUv;
    uniform sampler2D uTarget;
    uniform float aspectRatio;
    uniform vec3 color;
    uniform vec2 point;
    uniform float radius;

    void main () {
        vec2 p = vUv - point.xy;
        p.x *= aspectRatio;
        vec3 splat = exp(-dot(p, p) / radius) * color;
        vec3 base = texture2D(uTarget, vUv).xyz;
        gl_FragColor = vec4(base + splat, 1.0);
    }
`);

const advectionShader = compileShader(gl.FRAGMENT_SHADER, `
    precision highp float;
    precision highp sampler2D;

    varying vec2 vUv;
    uniform sampler2D uVelocity;
    uniform sampler2D uSource;
    uniform vec2 texelSize;
    uniform vec2 dyeTexelSize;
    uniform float dt;
    uniform float dissipation;

    vec4 bilerp (sampler2D sam, vec2 uv, vec2 tsize) {
        vec2 st = uv / tsize - 0.5;

        vec2 iuv = floor(st);
        vec2 fuv = fract(st);

        vec4 a = texture2D(sam, (iuv + vec2(0.5, 0.5)) * tsize);
        vec4 b = texture2D(sam, (iuv + vec2(1.5, 0.5)) * tsize);
        vec4 c = texture2D(sam, (iuv + vec2(0.5, 1.5)) * tsize);
        vec4 d = texture2D(sam, (iuv + vec2(1.5, 1.5)) * tsize);

        return mix(mix(a, b, fuv.x), mix(c, d, fuv.x), fuv.y);
    }

    void main () {
    #ifdef MANUAL_FILTERING
        vec2 coord = vUv - dt * bilerp(uVelocity, vUv, texelSize).xy * texelSize;
        vec4 result = bilerp(uSource, coord, dyeTexelSize);
    #else
        vec2 coord = vUv - dt * texture2D(uVelocity, vUv).xy * texelSize;
        vec4 result = texture2D(uSource, coord);
    #endif
        float decay = 1.0 + dissipation * dt;
        gl_FragColor = result / decay;
    }`,
    ext.supportLinearFiltering ? null : ['MANUAL_FILTERING']
);

const divergenceShader = compileShader(gl.FRAGMENT_SHADER, `
    precision mediump float;
    precision mediump sampler2D;

    varying highp vec2 vUv;
    varying highp vec2 vL;
    varying highp vec2 vR;
    varying highp vec2 vT;
    varying highp vec2 vB;
    uniform sampler2D uVelocity;

    void main () {
        float L = texture2D(uVelocity, vL).x;
        float R = texture2D(uVelocity, vR).x;
        float T = texture2D(uVelocity, vT).y;
        float B = texture2D(uVelocity, vB).y;

        vec2 C = texture2D(uVelocity, vUv).xy;
        if (vL.x < 0.0) { L = -C.x; }
        if (vR.x > 1.0) { R = -C.x; }
        if (vT.y > 1.0) { T = -C.y; }
        if (vB.y < 0.0) { B = -C.y; }

        float div = 0.5 * (R - L + T - B);
        gl_FragColor = vec4(div, 0.0, 0.0, 1.0);
    }
`);

const curlShader = compileShader(gl.FRAGMENT_SHADER, `
    precision mediump float;
    precision mediump sampler2D;

    varying highp vec2 vUv;
    varying highp vec2 vL;
    varying highp vec2 vR;
    varying highp vec2 vT;
    varying highp vec2 vB;
    uniform sampler2D uVelocity;

    void main () {
        float L = texture2D(uVelocity, vL).y;
        float R = texture2D(uVelocity, vR).y;
        float T = texture2D(uVelocity, vT).x;
        float B = texture2D(uVelocity, vB).x;
        float vorticity = R - L - T + B;
        gl_FragColor = vec4(0.5 * vorticity, 0.0, 0.0, 1.0);
    }
`);

const vorticityShader = compileShader(gl.FRAGMENT_SHADER, `
    precision highp float;
    precision highp sampler2D;

    varying vec2 vUv;
    varying vec2 vL;
    varying vec2 vR;
    varying vec2 vT;
    varying vec2 vB;
    uniform sampler2D uVelocity;
    uniform sampler2D uCurl;
    uniform float curl;
    uniform float dt;

    void main () {
        float L = texture2D(uCurl, vL).x;
        float R = texture2D(uCurl, vR).x;
        float T = texture2D(uCurl, vT).x;
        float B = texture2D(uCurl, vB).x;
        float C = texture2D(uCurl, vUv).x;

        vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
        force /= length(force) + 0.0001;
        force *= curl * C;
        force.y *= -1.0;

        vec2 velocity = texture2D(uVelocity, vUv).xy;
        velocity += force * dt;
        velocity = min(max(velocity, -1000.0), 1000.0);
        gl_FragColor = vec4(velocity, 0.0, 1.0);
    }
`);

const pressureShader = compileShader(gl.FRAGMENT_SHADER, `
    precision mediump float;
    precision mediump sampler2D;

    varying highp vec2 vUv;
    varying highp vec2 vL;
    varying highp vec2 vR;
    varying highp vec2 vT;
    varying highp vec2 vB;
    uniform sampler2D uPressure;
    uniform sampler2D uDivergence;

    void main () {
        float L = texture2D(uPressure, vL).x;
        float R = texture2D(uPressure, vR).x;
        float T = texture2D(uPressure, vT).x;
        float B = texture2D(uPressure, vB).x;
        float C = texture2D(uPressure, vUv).x;
        float divergence = texture2D(uDivergence, vUv).x;
        float pressure = (L + R + B + T - divergence) * 0.25;
        gl_FragColor = vec4(pressure, 0.0, 0.0, 1.0);
    }
`);

const gradientSubtractShader = compileShader(gl.FRAGMENT_SHADER, `
    precision mediump float;
    precision mediump sampler2D;

    varying highp vec2 vUv;
    varying highp vec2 vL;
    varying highp vec2 vR;
    varying highp vec2 vT;
    varying highp vec2 vB;
    uniform sampler2D uPressure;
    uniform sampler2D uVelocity;

    void main () {
        float L = texture2D(uPressure, vL).x;
        float R = texture2D(uPressure, vR).x;
        float T = texture2D(uPressure, vT).x;
        float B = texture2D(uPressure, vB).x;
        vec2 velocity = texture2D(uVelocity, vUv).xy;
        velocity.xy -= vec2(R - L, T - B);
        gl_FragColor = vec4(velocity, 0.0, 1.0);
    }
`);

const blit = (() => {
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(0);

    return (target, clear = false) => {
        if (target == null)
        {
            gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        }
        else
        {
            gl.viewport(0, 0, target.width, target.height);
            gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
        }
        if (clear)
        {
            gl.clearColor(0.0, 0.0, 0.0, 1.0);
            gl.clear(gl.COLOR_BUFFER_BIT);
        }
        // CHECK_FRAMEBUFFER_STATUS();
        gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
    }
})();

function CHECK_FRAMEBUFFER_STATUS () {
    let status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status != gl.FRAMEBUFFER_COMPLETE)
        console.trace("Framebuffer error: " + status);
}

let dye;
let velocity;
let divergence;
let curl;
let pressure;
let bloom;
let bloomFramebuffers = [];
let sunrays;
let sunraysTemp;

let ditheringTexture = createTextureAsync('LDR_LLL1_0.png');

const blurProgram            = new Program(blurVertexShader, blurShader);
const copyProgram            = new Program(baseVertexShader, copyShader);
const clearProgram           = new Program(baseVertexShader, clearShader);
const colorProgram           = new Program(baseVertexShader, colorShader);
const checkerboardProgram    = new Program(baseVertexShader, checkerboardShader);
const bloomPrefilterProgram  = new Program(baseVertexShader, bloomPrefilterShader);
const bloomBlurProgram       = new Program(baseVertexShader, bloomBlurShader);
const bloomFinalProgram      = new Program(baseVertexShader, bloomFinalShader);
const sunraysMaskProgram     = new Program(baseVertexShader, sunraysMaskShader);
const sunraysProgram         = new Program(baseVertexShader, sunraysShader);
const splatProgram           = new Program(baseVertexShader, splatShader);
const advectionProgram       = new Program(baseVertexShader, advectionShader);
const divergenceProgram      = new Program(baseVertexShader, divergenceShader);
const curlProgram            = new Program(baseVertexShader, curlShader);
const vorticityProgram       = new Program(baseVertexShader, vorticityShader);
const pressureProgram        = new Program(baseVertexShader, pressureShader);
const gradienSubtractProgram = new Program(baseVertexShader, gradientSubtractShader);

const displayMaterial = new Material(baseVertexShader, displayShaderSource);

function clearCanvas () {
    gl.clearColor(0, 0, 0, 0);

    gl.bindFramebuffer(gl.FRAMEBUFFER, dye.read.fbo);
    gl.viewport(0, 0, dye.read.width, dye.read.height);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.bindFramebuffer(gl.FRAMEBUFFER, dye.write.fbo);
    gl.viewport(0, 0, dye.write.width, dye.write.height);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.bindFramebuffer(gl.FRAMEBUFFER, velocity.read.fbo);
    gl.viewport(0, 0, velocity.read.width, velocity.read.height);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.bindFramebuffer(gl.FRAMEBUFFER, velocity.write.fbo);
    gl.viewport(0, 0, velocity.write.width, velocity.write.height);
    gl.clear(gl.COLOR_BUFFER_BIT);
}

function initFramebuffers () {
    let simRes = getResolution(config.SIM_RESOLUTION);
    let dyeRes = getResolution(config.DYE_RESOLUTION);

    const texType = ext.halfFloatTexType;
    const rgba    = ext.formatRGBA;
    const rg      = ext.formatRG;
    const r       = ext.formatR;
    const filtering = ext.supportLinearFiltering ? gl.LINEAR : gl.NEAREST;

    gl.disable(gl.BLEND);

    if (dye == null)
        dye = createDoubleFBO(dyeRes.width, dyeRes.height, rgba.internalFormat, rgba.format, texType, filtering);
    else
        dye = resizeDoubleFBO(dye, dyeRes.width, dyeRes.height, rgba.internalFormat, rgba.format, texType, filtering);

    if (velocity == null)
        velocity = createDoubleFBO(simRes.width, simRes.height, rg.internalFormat, rg.format, texType, filtering);
    else
        velocity = resizeDoubleFBO(velocity, simRes.width, simRes.height, rg.internalFormat, rg.format, texType, filtering);

    divergence = createFBO      (simRes.width, simRes.height, r.internalFormat, r.format, texType, gl.NEAREST);
    curl       = createFBO      (simRes.width, simRes.height, r.internalFormat, r.format, texType, gl.NEAREST);
    pressure   = createDoubleFBO(simRes.width, simRes.height, r.internalFormat, r.format, texType, gl.NEAREST);

    initBloomFramebuffers();
    initSunraysFramebuffers();
}

function initBloomFramebuffers () {
    let res = getResolution(config.BLOOM_RESOLUTION);

    const texType = ext.halfFloatTexType;
    const rgba = ext.formatRGBA;
    const filtering = ext.supportLinearFiltering ? gl.LINEAR : gl.NEAREST;

    bloom = createFBO(res.width, res.height, rgba.internalFormat, rgba.format, texType, filtering);

    bloomFramebuffers.length = 0;
    for (let i = 0; i < config.BLOOM_ITERATIONS; i++)
    {
        let width = res.width >> (i + 1);
        let height = res.height >> (i + 1);

        if (width < 2 || height < 2) break;

        let fbo = createFBO(width, height, rgba.internalFormat, rgba.format, texType, filtering);
        bloomFramebuffers.push(fbo);
    }
}

function initSunraysFramebuffers () {
    let res = getResolution(config.SUNRAYS_RESOLUTION);

    const texType = ext.halfFloatTexType;
    const r = ext.formatR;
    const filtering = ext.supportLinearFiltering ? gl.LINEAR : gl.NEAREST;

    sunrays     = createFBO(res.width, res.height, r.internalFormat, r.format, texType, filtering);
    sunraysTemp = createFBO(res.width, res.height, r.internalFormat, r.format, texType, filtering);
}

function createFBO (w, h, internalFormat, format, type, param) {
    gl.activeTexture(gl.TEXTURE0);
    let texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, param);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, param);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, format, type, null);

    let fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.viewport(0, 0, w, h);
    gl.clear(gl.COLOR_BUFFER_BIT);

    let texelSizeX = 1.0 / w;
    let texelSizeY = 1.0 / h;

    return {
        texture,
        fbo,
        width: w,
        height: h,
        texelSizeX,
        texelSizeY,
        attach (id) {
            gl.activeTexture(gl.TEXTURE0 + id);
            gl.bindTexture(gl.TEXTURE_2D, texture);
            return id;
        }
    };
}

function createDoubleFBO (w, h, internalFormat, format, type, param) {
    let fbo1 = createFBO(w, h, internalFormat, format, type, param);
    let fbo2 = createFBO(w, h, internalFormat, format, type, param);

    return {
        width: w,
        height: h,
        texelSizeX: fbo1.texelSizeX,
        texelSizeY: fbo1.texelSizeY,
        get read () {
            return fbo1;
        },
        set read (value) {
            fbo1 = value;
        },
        get write () {
            return fbo2;
        },
        set write (value) {
            fbo2 = value;
        },
        swap () {
            let temp = fbo1;
            fbo1 = fbo2;
            fbo2 = temp;
        }
    }
}

function resizeFBO (target, w, h, internalFormat, format, type, param) {
    let newFBO = createFBO(w, h, internalFormat, format, type, param);
    copyProgram.bind();
    gl.uniform1i(copyProgram.uniforms.uTexture, target.attach(0));
    blit(newFBO);
    return newFBO;
}

function resizeDoubleFBO (target, w, h, internalFormat, format, type, param) {
    if (target.width == w && target.height == h)
        return target;
    target.read = resizeFBO(target.read, w, h, internalFormat, format, type, param);
    target.write = createFBO(w, h, internalFormat, format, type, param);
    target.width = w;
    target.height = h;
    target.texelSizeX = 1.0 / w;
    target.texelSizeY = 1.0 / h;
    return target;
}

function createTextureAsync (url) {
    let texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, 1, 1, 0, gl.RGB, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255]));

    let obj = {
        texture,
        width: 1,
        height: 1,
        attach (id) {
            gl.activeTexture(gl.TEXTURE0 + id);
            gl.bindTexture(gl.TEXTURE_2D, texture);
            return id;
        }
    };

    let image = new Image();
    image.onload = () => {
        obj.width = image.width;
        obj.height = image.height;
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, image);
    };
    image.src = url;

    return obj;
}

function updateKeywords () {
    let displayKeywords = [];
    if (config.SHADING) displayKeywords.push("SHADING");
    if (config.BLOOM) displayKeywords.push("BLOOM");
    if (config.SUNRAYS) displayKeywords.push("SUNRAYS");
    if (config.POSTERIZE) displayKeywords.push("POSTERIZE");
    displayMaterial.setKeywords(displayKeywords);
}

updateKeywords();
initFramebuffers();
multipleSplats(parseInt(Math.random() * 20) + 5);

let lastUpdateTime = Date.now();
let colorUpdateTimer = 0.0;
update();

function update () {
    const dt = calcDeltaTime();
    if (resizeCanvas())
        initFramebuffers();
    updateColors(dt);
    applyInputs();
    if (!config.PAUSED)
        step(dt);
    render(null);
    requestAnimationFrame(update);
}

function calcDeltaTime () {
    let now = Date.now();
    let dt = (now - lastUpdateTime) / 1000;
    dt = Math.min(dt, 0.016666);
    lastUpdateTime = now;
    return dt;
}

function resizeCanvas () {
    let width = scaleByPixelRatio(canvas.clientWidth);
    let height = scaleByPixelRatio(canvas.clientHeight);
    if (canvas.width != width || canvas.height != height) {
        canvas.width = width;
        canvas.height = height;
        return true;
    }
    return false;
}

function updateColors (dt) {
    if (!config.COLORFUL) return;

    colorUpdateTimer += dt * config.COLOR_UPDATE_SPEED;
    if (colorUpdateTimer >= 1) {
        colorUpdateTimer = wrap(colorUpdateTimer, 0, 1);
        pointers.forEach(p => {
            p.color = generateColor();
        });
    }
}

function applyInputs () {
    if (splatStack.length > 0)
        multipleSplats(splatStack.pop());

    pointers.forEach(p => {
        if (p.moved) {
            p.moved = false;
            splatPointer(p);
        }
    });
}

function step (dt) {
    gl.disable(gl.BLEND);

    curlProgram.bind();
    gl.uniform2f(curlProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(curlProgram.uniforms.uVelocity, velocity.read.attach(0));
    blit(curl);

    vorticityProgram.bind();
    gl.uniform2f(vorticityProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(vorticityProgram.uniforms.uVelocity, velocity.read.attach(0));
    gl.uniform1i(vorticityProgram.uniforms.uCurl, curl.attach(1));
    gl.uniform1f(vorticityProgram.uniforms.curl, config.CURL);
    gl.uniform1f(vorticityProgram.uniforms.dt, dt);
    blit(velocity.write);
    velocity.swap();

    divergenceProgram.bind();
    gl.uniform2f(divergenceProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(divergenceProgram.uniforms.uVelocity, velocity.read.attach(0));
    blit(divergence);

    clearProgram.bind();
    gl.uniform1i(clearProgram.uniforms.uTexture, pressure.read.attach(0));
    gl.uniform1f(clearProgram.uniforms.value, config.PRESSURE);
    blit(pressure.write);
    pressure.swap();

    pressureProgram.bind();
    gl.uniform2f(pressureProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(pressureProgram.uniforms.uDivergence, divergence.attach(0));
    for (let i = 0; i < config.PRESSURE_ITERATIONS; i++) {
        gl.uniform1i(pressureProgram.uniforms.uPressure, pressure.read.attach(1));
        blit(pressure.write);
        pressure.swap();
    }

    gradienSubtractProgram.bind();
    gl.uniform2f(gradienSubtractProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(gradienSubtractProgram.uniforms.uPressure, pressure.read.attach(0));
    gl.uniform1i(gradienSubtractProgram.uniforms.uVelocity, velocity.read.attach(1));
    blit(velocity.write);
    velocity.swap();

    advectionProgram.bind();
    gl.uniform2f(advectionProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    if (!ext.supportLinearFiltering)
        gl.uniform2f(advectionProgram.uniforms.dyeTexelSize, velocity.texelSizeX, velocity.texelSizeY);
    let velocityId = velocity.read.attach(0);
    gl.uniform1i(advectionProgram.uniforms.uVelocity, velocityId);
    gl.uniform1i(advectionProgram.uniforms.uSource, velocityId);
    gl.uniform1f(advectionProgram.uniforms.dt, dt);
    gl.uniform1f(advectionProgram.uniforms.dissipation, config.VELOCITY_DISSIPATION);
    blit(velocity.write);
    velocity.swap();

    if (!ext.supportLinearFiltering)
        gl.uniform2f(advectionProgram.uniforms.dyeTexelSize, dye.texelSizeX, dye.texelSizeY);
    gl.uniform1i(advectionProgram.uniforms.uVelocity, velocity.read.attach(0));
    gl.uniform1i(advectionProgram.uniforms.uSource, dye.read.attach(1));
    gl.uniform1f(advectionProgram.uniforms.dissipation, config.DENSITY_DISSIPATION);
    blit(dye.write);
    dye.swap();
}

function render (target) {
    if (config.BLOOM)
        applyBloom(dye.read, bloom);
    if (config.SUNRAYS) {
        applySunrays(dye.read, dye.write, sunrays);
        blur(sunrays, sunraysTemp, 1);
    }

    if (target == null || !config.TRANSPARENT) {
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.enable(gl.BLEND);
    }
    else {
        gl.disable(gl.BLEND);
    }

    if (!config.TRANSPARENT)
        drawColor(target, normalizeColor(config.BACK_COLOR));
    if (target == null && config.TRANSPARENT)
        drawCheckerboard(target);
    drawDisplay(target);
}

function drawColor (target, color) {
    colorProgram.bind();
    gl.uniform4f(colorProgram.uniforms.color, color.r, color.g, color.b, 1);
    blit(target);
}

function drawCheckerboard (target) {
    checkerboardProgram.bind();
    gl.uniform1f(checkerboardProgram.uniforms.aspectRatio, canvas.width / canvas.height);
    blit(target);
}

function drawDisplay (target) {
    let width = target == null ? gl.drawingBufferWidth : target.width;
    let height = target == null ? gl.drawingBufferHeight : target.height;

    displayMaterial.bind();
    if (config.SHADING || config.POSTERIZE)
        gl.uniform2f(displayMaterial.uniforms.texelSize, 1.0 / width, 1.0 / height);
    gl.uniform1i(displayMaterial.uniforms.uTexture, dye.read.attach(0));
    if (config.BLOOM) {
        gl.uniform1i(displayMaterial.uniforms.uBloom, bloom.attach(1));
        gl.uniform1i(displayMaterial.uniforms.uDithering, ditheringTexture.attach(2));
        let scale = getTextureScale(ditheringTexture, width, height);
        gl.uniform2f(displayMaterial.uniforms.ditherScale, scale.x, scale.y);
    }
    if (config.SUNRAYS)
        gl.uniform1i(displayMaterial.uniforms.uSunrays, sunrays.attach(3));
    if (config.POSTERIZE) {
        gl.uniform3f(displayMaterial.uniforms.uBackColor, config.BACK_COLOR.r / 255, config.BACK_COLOR.g / 255, config.BACK_COLOR.b / 255);
        gl.uniform1f(displayMaterial.uniforms.uPosterizeLevels, config.POSTERIZE_LEVELS);
        gl.uniform1f(displayMaterial.uniforms.uEdgeStrength, config.EDGE_STRENGTH);
    }
    blit(target);
}

function applyBloom (source, destination) {
    if (bloomFramebuffers.length < 2)
        return;

    let last = destination;

    gl.disable(gl.BLEND);
    bloomPrefilterProgram.bind();
    let knee = config.BLOOM_THRESHOLD * config.BLOOM_SOFT_KNEE + 0.0001;
    let curve0 = config.BLOOM_THRESHOLD - knee;
    let curve1 = knee * 2;
    let curve2 = 0.25 / knee;
    gl.uniform3f(bloomPrefilterProgram.uniforms.curve, curve0, curve1, curve2);
    gl.uniform1f(bloomPrefilterProgram.uniforms.threshold, config.BLOOM_THRESHOLD);
    gl.uniform1i(bloomPrefilterProgram.uniforms.uTexture, source.attach(0));
    blit(last);

    bloomBlurProgram.bind();
    for (let i = 0; i < bloomFramebuffers.length; i++) {
        let dest = bloomFramebuffers[i];
        gl.uniform2f(bloomBlurProgram.uniforms.texelSize, last.texelSizeX, last.texelSizeY);
        gl.uniform1i(bloomBlurProgram.uniforms.uTexture, last.attach(0));
        blit(dest);
        last = dest;
    }

    gl.blendFunc(gl.ONE, gl.ONE);
    gl.enable(gl.BLEND);

    for (let i = bloomFramebuffers.length - 2; i >= 0; i--) {
        let baseTex = bloomFramebuffers[i];
        gl.uniform2f(bloomBlurProgram.uniforms.texelSize, last.texelSizeX, last.texelSizeY);
        gl.uniform1i(bloomBlurProgram.uniforms.uTexture, last.attach(0));
        gl.viewport(0, 0, baseTex.width, baseTex.height);
        blit(baseTex);
        last = baseTex;
    }

    gl.disable(gl.BLEND);
    bloomFinalProgram.bind();
    gl.uniform2f(bloomFinalProgram.uniforms.texelSize, last.texelSizeX, last.texelSizeY);
    gl.uniform1i(bloomFinalProgram.uniforms.uTexture, last.attach(0));
    gl.uniform1f(bloomFinalProgram.uniforms.intensity, config.BLOOM_INTENSITY);
    blit(destination);
}

function applySunrays (source, mask, destination) {
    gl.disable(gl.BLEND);
    sunraysMaskProgram.bind();
    gl.uniform1i(sunraysMaskProgram.uniforms.uTexture, source.attach(0));
    blit(mask);

    sunraysProgram.bind();
    gl.uniform1f(sunraysProgram.uniforms.weight, config.SUNRAYS_WEIGHT);
    gl.uniform1i(sunraysProgram.uniforms.uTexture, mask.attach(0));
    blit(destination);
}

function blur (target, temp, iterations) {
    blurProgram.bind();
    for (let i = 0; i < iterations; i++) {
        gl.uniform2f(blurProgram.uniforms.texelSize, target.texelSizeX, 0.0);
        gl.uniform1i(blurProgram.uniforms.uTexture, target.attach(0));
        blit(temp);

        gl.uniform2f(blurProgram.uniforms.texelSize, 0.0, target.texelSizeY);
        gl.uniform1i(blurProgram.uniforms.uTexture, temp.attach(0));
        blit(target);
    }
}

function splatPointer (pointer) {
    let dx = pointer.deltaX * config.SPLAT_FORCE;
    let dy = pointer.deltaY * config.SPLAT_FORCE;
    splat(pointer.texcoordX, pointer.texcoordY, dx, dy, pointer.color);
}

function multipleSplats (amount) {
    for (let i = 0; i < amount; i++) {
        const color = generateColor();
        color.r *= 10.0;
        color.g *= 10.0;
        color.b *= 10.0;
        const x = Math.random();
        const y = Math.random();
        const dx = 1000 * (Math.random() - 0.5);
        const dy = 1000 * (Math.random() - 0.5);
        splat(x, y, dx, dy, color);
    }
}

function splat (x, y, dx, dy, color) {
    splatProgram.bind();
    gl.uniform1i(splatProgram.uniforms.uTarget, velocity.read.attach(0));
    gl.uniform1f(splatProgram.uniforms.aspectRatio, canvas.width / canvas.height);
    gl.uniform2f(splatProgram.uniforms.point, x, y);
    gl.uniform3f(splatProgram.uniforms.color, dx, dy, 0.0);
    gl.uniform1f(splatProgram.uniforms.radius, correctRadius(config.SPLAT_RADIUS / 100.0));
    blit(velocity.write);
    velocity.swap();

    gl.uniform1i(splatProgram.uniforms.uTarget, dye.read.attach(0));
    gl.uniform3f(splatProgram.uniforms.color, color.r, color.g, color.b);
    blit(dye.write);
    dye.swap();
}

function correctRadius (radius) {
    let aspectRatio = canvas.width / canvas.height;
    if (aspectRatio > 1)
        radius *= aspectRatio;
    return radius;
}

canvas.addEventListener('mousedown', e => {
    let posX = scaleByPixelRatio(e.offsetX);
    let posY = scaleByPixelRatio(e.offsetY);
    let pointer = pointers.find(p => p.id == -1);
    if (pointer == null)
        pointer = new pointerPrototype();
    updatePointerDownData(pointer, -1, posX, posY);
});

canvas.addEventListener('mousemove', e => {
    let pointer = pointers[0];
    if (!pointer.down) return;
    let posX = scaleByPixelRatio(e.offsetX);
    let posY = scaleByPixelRatio(e.offsetY);
    updatePointerMoveData(pointer, posX, posY);
});

window.addEventListener('mouseup', () => {
    updatePointerUpData(pointers[0]);
});

canvas.addEventListener('touchstart', e => {
    e.preventDefault();
    const touches = e.targetTouches;
    while (touches.length >= pointers.length)
        pointers.push(new pointerPrototype());
    for (let i = 0; i < touches.length; i++) {
        let posX = scaleByPixelRatio(touches[i].pageX);
        let posY = scaleByPixelRatio(touches[i].pageY);
        updatePointerDownData(pointers[i + 1], touches[i].identifier, posX, posY);
    }
});

canvas.addEventListener('touchmove', e => {
    e.preventDefault();
    const touches = e.targetTouches;
    for (let i = 0; i < touches.length; i++) {
        let pointer = pointers[i + 1];
        if (!pointer.down) continue;
        let posX = scaleByPixelRatio(touches[i].pageX);
        let posY = scaleByPixelRatio(touches[i].pageY);
        updatePointerMoveData(pointer, posX, posY);
    }
}, false);

window.addEventListener('touchend', e => {
    const touches = e.changedTouches;
    for (let i = 0; i < touches.length; i++)
    {
        let pointer = pointers.find(p => p.id == touches[i].identifier);
        if (pointer == null) continue;
        updatePointerUpData(pointer);
    }
});

window.addEventListener('keydown', e => {
    if (e.code === 'KeyP')
        config.PAUSED = !config.PAUSED;
    if (e.key === ' ')
        splatStack.push(parseInt(Math.random() * 20) + 5);
});

function updatePointerDownData (pointer, id, posX, posY) {
    pointer.id = id;
    pointer.down = true;
    pointer.moved = false;
    pointer.texcoordX = posX / canvas.width;
    pointer.texcoordY = 1.0 - posY / canvas.height;
    pointer.prevTexcoordX = pointer.texcoordX;
    pointer.prevTexcoordY = pointer.texcoordY;
    pointer.deltaX = 0;
    pointer.deltaY = 0;
    pointer.color = generateColor();
}

function updatePointerMoveData (pointer, posX, posY) {
    pointer.prevTexcoordX = pointer.texcoordX;
    pointer.prevTexcoordY = pointer.texcoordY;
    pointer.texcoordX = posX / canvas.width;
    pointer.texcoordY = 1.0 - posY / canvas.height;
    pointer.deltaX = correctDeltaX(pointer.texcoordX - pointer.prevTexcoordX);
    pointer.deltaY = correctDeltaY(pointer.texcoordY - pointer.prevTexcoordY);
    pointer.moved = Math.abs(pointer.deltaX) > 0 || Math.abs(pointer.deltaY) > 0;
}

function updatePointerUpData (pointer) {
    pointer.down = false;
}

function correctDeltaX (delta) {
    let aspectRatio = canvas.width / canvas.height;
    if (aspectRatio < 1) delta *= aspectRatio;
    return delta;
}

function correctDeltaY (delta) {
    let aspectRatio = canvas.width / canvas.height;
    if (aspectRatio > 1) delta /= aspectRatio;
    return delta;
}

function hexToRGB01 (hex) {
    hex = hex.replace('#', '');
    return {
        r: parseInt(hex.substring(0, 2), 16) / 255,
        g: parseInt(hex.substring(2, 4), 16) / 255,
        b: parseInt(hex.substring(4, 6), 16) / 255,
    };
}

function generateColor () {
    if (config.USE_PALETTE && config.PALETTE.length > 0) {
        let hex = config.PALETTE[Math.floor(Math.random() * config.PALETTE.length)];
        return hexToRGB01(hex);
    }
    let c = HSVtoRGB(Math.random(), config.COLOR_SATURATION, config.COLOR_VALUE);
    c.r *= config.COLOR_MULTIPLIER;
    c.g *= config.COLOR_MULTIPLIER;
    c.b *= config.COLOR_MULTIPLIER;
    return c;
}

function HSVtoRGB (h, s, v) {
    let r, g, b, i, f, p, q, t;
    i = Math.floor(h * 6);
    f = h * 6 - i;
    p = v * (1 - s);
    q = v * (1 - f * s);
    t = v * (1 - (1 - f) * s);

    switch (i % 6) {
        case 0: r = v, g = t, b = p; break;
        case 1: r = q, g = v, b = p; break;
        case 2: r = p, g = v, b = t; break;
        case 3: r = p, g = q, b = v; break;
        case 4: r = t, g = p, b = v; break;
        case 5: r = v, g = p, b = q; break;
    }

    return {
        r,
        g,
        b
    };
}

function normalizeColor (input) {
    let output = {
        r: input.r / 255,
        g: input.g / 255,
        b: input.b / 255
    };
    return output;
}

function wrap (value, min, max) {
    let range = max - min;
    if (range == 0) return min;
    return (value - min) % range + min;
}

function getResolution (resolution) {
    let aspectRatio = gl.drawingBufferWidth / gl.drawingBufferHeight;
    if (aspectRatio < 1)
        aspectRatio = 1.0 / aspectRatio;

    let min = Math.round(resolution);
    let max = Math.round(resolution * aspectRatio);

    if (gl.drawingBufferWidth > gl.drawingBufferHeight)
        return { width: max, height: min };
    else
        return { width: min, height: max };
}

function getTextureScale (texture, width, height) {
    return {
        x: width / texture.width,
        y: height / texture.height
    };
}

function scaleByPixelRatio (input) {
    let pixelRatio = window.devicePixelRatio || 1;
    return Math.floor(input * pixelRatio);
}

function hashCode (s) {
    if (s.length == 0) return 0;
    let hash = 0;
    for (let i = 0; i < s.length; i++) {
        hash = (hash << 5) - hash + s.charCodeAt(i);
        hash |= 0; // Convert to 32bit integer
    }
    return hash;
};
// ============================
// SLEEK MINIMAL UI + CONTROLS TOGGLE (gear icon)
// ============================
window.addEventListener('load', () => {
    const fontLink = document.createElement('link');
    fontLink.rel = 'stylesheet';
    fontLink.href = 'https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&display=swap';
    document.head.appendChild(fontLink);

    const style = document.createElement('style');
    style.innerHTML = `
        .dg, .dg * {
            text-shadow: none !important;
        }
        .dg.main {
            font-family: 'Space Mono', monospace !important;
            background: rgba(16, 18, 22, 0.55) !important;
            backdrop-filter: blur(16px) saturate(160%);
            -webkit-backdrop-filter: blur(16px) saturate(160%);
            border: 1px solid rgba(255, 255, 255, 0.08) !important;
            border-radius: 10px !important;
            overflow: hidden;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.25);
            padding: 4px;
        }
        .dg.main .close-button { display: none !important; }
        .dg .property-name {
            color: rgba(235, 235, 240, 0.75) !important;
            font-size: 11px;
            letter-spacing: 0.03em;
        }
        .dg li:not(.folder) {
            background: transparent !important;
            border-bottom: 1px solid rgba(255, 255, 255, 0.05) !important;
        }
        .dg li.folder { border: none !important; }
        .dg .title {
            background: rgba(255, 255, 255, 0.03) !important;
            color: rgba(235, 235, 240, 0.9) !important;
            border-radius: 6px !important;
            border-bottom: 1px solid rgba(255, 255, 255, 0.06) !important;
            font-weight: 700;
            font-size: 11px;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            margin: 2px 0;
        }
        .dg .title:hover {
            background: rgba(255, 255, 255, 0.06) !important;
        }
        .dg .cr.function {
            background: transparent !important;
            border: 1px solid rgba(255, 255, 255, 0.1) !important;
            border-radius: 6px !important;
            margin: 3px 4px;
            transition: background 0.15s ease, border-color 0.15s ease;
        }
        .dg .cr.function:hover {
            background: rgba(125, 224, 214, 0.08) !important;
            border-color: rgba(125, 224, 214, 0.4) !important;
        }
        .dg .cr.function .property-name {
            color: rgba(125, 224, 214, 0.9) !important;
            text-align: center;
            width: 100%;
            font-weight: 700;
            font-size: 10px;
            letter-spacing: 0.06em;
            text-transform: uppercase;
        }
        .dg .cr.boolean { border: none !important; }
        .dg .c input[type=text] {
            background: rgba(255, 255, 255, 0.05) !important;
            color: rgba(235, 235, 240, 0.85) !important;
            border-radius: 4px !important;
            border: 1px solid rgba(255, 255, 255, 0.08) !important;
            box-shadow: none !important;
            font-family: 'Space Mono', monospace !important;
        }
        .dg .slider {
            background: rgba(255, 255, 255, 0.06) !important;
            border-radius: 4px !important;
            border: none !important;
        }
        .dg .slider-fg {
            background: rgba(125, 224, 214, 0.55) !important;
            border-radius: 4px !important;
        }
        .dg select {
            background: rgba(255, 255, 255, 0.05) !important;
            color: rgba(235, 235, 240, 0.85) !important;
            border: 1px solid rgba(255, 255, 255, 0.08) !important;
            border-radius: 4px !important;
            font-family: 'Space Mono', monospace !important;
        }
        .preset-delete {
            position: absolute;
            right: 8px;
            top: 50%;
            transform: translateY(-50%);
            opacity: 0.35;
            font-size: 11px;
            cursor: pointer;
            color: rgba(235, 235, 240, 0.7);
        }
        .preset-delete:hover { opacity: 1; color: #ff8a8a; }
    `;
    document.head.appendChild(style);

    const gearBtn = document.createElement('div');
    gearBtn.innerHTML = '⚙';
    gearBtn.style.position = 'fixed';
    gearBtn.style.top = '14px';
    gearBtn.style.right = '14px';
    gearBtn.style.width = '38px';
    gearBtn.style.height = '38px';
    gearBtn.style.display = 'flex';
    gearBtn.style.alignItems = 'center';
    gearBtn.style.justifyContent = 'center';
    gearBtn.style.fontSize = '18px';
    gearBtn.style.fontFamily = "'Space Mono', monospace";
    gearBtn.style.color = 'rgba(125, 224, 214, 0.9)';
    gearBtn.style.background = 'rgba(16, 18, 22, 0.55)';
    gearBtn.style.backdropFilter = 'blur(16px) saturate(160%)';
    gearBtn.style.border = '1px solid rgba(255, 255, 255, 0.1)';
    gearBtn.style.borderRadius = '50%';
    gearBtn.style.cursor = 'pointer';
    gearBtn.style.zIndex = '50';
    gearBtn.style.userSelect = 'none';
    gearBtn.style.boxShadow = '0 4px 16px rgba(0,0,0,0.2)';
    gearBtn.style.transition = 'transform 0.4s ease, border-color 0.2s ease';
    gearBtn.title = 'Settings';

    gearBtn.addEventListener('mouseenter', () => {
        gearBtn.style.transform = 'rotate(60deg)';
        gearBtn.style.borderColor = 'rgba(125, 224, 214, 0.5)';
    });
    gearBtn.addEventListener('mouseleave', () => {
        gearBtn.style.transform = 'rotate(0deg)';
        gearBtn.style.borderColor = 'rgba(255, 255, 255, 0.1)';
    });

    gearBtn.addEventListener('click', () => {
        const gui = window.__fluidGUI;
        if (!gui) return;
        const visible = gui.domElement.style.display !== 'none';
        gui.domElement.style.display = visible ? 'none' : '';
    });

    document.body.appendChild(gearBtn);
});

// ============================
// PAPER TEXTURE OVERLAY (subtle)
// ============================
window.addEventListener('load', () => {
    const noiseSVG = `
        <svg xmlns='http://www.w3.org/2000/svg' width='100%' height='100%'>
            <filter id='n'>
                <feTurbulence type='fractalNoise' baseFrequency='0.04' numOctaves='2' stitchTiles='stitch' result='noise'/>
                <feColorMatrix type='matrix' values='0 0 0 0 0.55  0 0 0 0 0.5  0 0 0 0 0.45  0 0 0 0.4 0'/>
            </filter>
            <rect width='100%' height='100%' filter='url(%23n)'/>
        </svg>`;
    const encoded = encodeURIComponent(noiseSVG);

    const paper = document.createElement('div');
    paper.style.position = 'fixed';
    paper.style.top = '0';
    paper.style.left = '0';
    paper.style.width = '100%';
    paper.style.height = '100%';
    paper.style.pointerEvents = 'none';
    paper.style.zIndex = '40';
    paper.style.mixBlendMode = 'soft-light';
    paper.style.opacity = '0.35';
    paper.style.backgroundImage = `url("data:image/svg+xml,${encoded}")`;
    paper.style.backgroundSize = '600px 600px';

    document.body.appendChild(paper);
});

// ============================
// KEYBOARD SHORTCUTS
// B = black bg, W = white bg, P = paper (default)
// S = save / export painting, C = clear canvas
// ============================
window.addEventListener('keydown', e => {
    if (e.key === 'b' || e.key === 'B') {
        config.BACK_COLOR = { r: 0, g: 0, b: 0 };
    }
    if (e.key === 'w' || e.key === 'W') {
        config.BACK_COLOR = { r: 255, g: 255, b: 255 };
    }
    if (e.key === 'p' || e.key === 'P') {
        config.BACK_COLOR = { r: 238, g: 232, b: 220 };
    }
    if (e.key === 's' || e.key === 'S') {
        captureScreenshot();
    }
    if (e.key === 'c' || e.key === 'C') {
        clearCanvas();
    }
});

// ============================
// WELCOME SCREEN + AUDIO + PITCH-AWARE COLOR + FULLSCREEN + SHARE
// ============================
window.addEventListener('load', () => {

    // ── floating notes animation on welcome screen ──────────────────
    const noteChars = ['♩','♪','♫','♬','𝄞'];
    function spawnNote (container) {
        const n = document.createElement('div');
        n.textContent = noteChars[Math.floor(Math.random() * noteChars.length)];
        n.style.position = 'absolute';
        n.style.left = (10 + Math.random() * 80) + '%';
        n.style.bottom = '-30px';
        n.style.fontSize = (12 + Math.random() * 14) + 'px';
        n.style.opacity = '0';
        n.style.color = 'rgba(125, 224, 214, 0.7)';
        n.style.pointerEvents = 'none';
        n.style.transition = 'bottom 3.5s ease-out, opacity 3.5s ease';
        container.appendChild(n);
        requestAnimationFrame(() => {
            n.style.bottom = (50 + Math.random() * 40) + '%';
            n.style.opacity = '1';
        });
        setTimeout(() => {
            n.style.opacity = '0';
            setTimeout(() => n.remove(), 800);
        }, 2800);
    }

    // ── overlay ──────────────────────────────────────────────────────
    const overlay = document.createElement('div');
    overlay.style.position = 'fixed';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100%';
    overlay.style.height = '100%';
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.background = 'rgba(10, 12, 16, 0.82)';
    overlay.style.backdropFilter = 'blur(14px)';
    overlay.style.zIndex = '60';
    overlay.style.cursor = 'pointer';
    overlay.style.fontFamily = "'Space Mono', monospace";
    overlay.style.color = 'rgba(235, 235, 240, 0.92)';
    overlay.style.textAlign = 'center';
    overlay.style.transition = 'opacity 0.6s ease';
    overlay.style.overflow = 'hidden';

    overlay.innerHTML = `
        <div id="wc-card" style="
            border:1px solid rgba(255,255,255,0.12);
            border-radius:14px;
            padding:36px 44px;
            background:rgba(255,255,255,0.03);
            max-width:340px;
            position:relative;
        ">
            <div style="font-size:28px; margin-bottom:10px;">𝄞</div>
            <div style="font-size:22px; font-weight:700; letter-spacing:0.04em; margin-bottom:6px; color:#fff;">
                soundpainter
            </div>
            <div style="font-size:11px; opacity:0.5; letter-spacing:0.1em; text-transform:uppercase; margin-bottom:24px;">
                your music becomes art
            </div>
            <div id="wc-btn" style="
                display:inline-block;
                padding:10px 24px;
                border:1px solid rgba(125, 224, 214, 0.5);
                border-radius:6px;
                font-size:11px;
                letter-spacing:0.1em;
                text-transform:uppercase;
                color:rgba(125, 224, 214, 0.9);
                transition: background 0.2s ease;
                cursor:pointer;
            ">tap &amp; play</div>
            <div style="font-size:10px; opacity:0.35; margin-top:14px; letter-spacing:0.06em;">
                allow mic access when prompted
            </div>
        </div>`;

    document.body.appendChild(overlay);

    // floating notes loop
    const noteInterval = setInterval(() => spawnNote(overlay), 1000);

    // hover effect on btn
    const wcBtn = overlay.querySelector('#wc-btn');
    wcBtn.addEventListener('mouseenter', () => wcBtn.style.background = 'rgba(125, 224, 214, 0.08)');
    wcBtn.addEventListener('mouseleave', () => wcBtn.style.background = 'transparent');

    // ── start everything on click ─────────────────────────────────────
    let lastSoundTime = performance.now();
    let nextIdleGap = 12000 + Math.random() * 8000;

    overlay.addEventListener('click', () => {
        clearInterval(noteInterval);
        overlay.style.opacity = '0';
        setTimeout(() => overlay.remove(), 600);

        const MIC_SENSITIVITY = 0.18;
        const SPLAT_COOLDOWN  = 180;
        let lastFire = 0;

        navigator.mediaDevices.getUserMedia({ audio: true, video: false })
            .then(stream => {
                const ctx = new (window.AudioContext || window.webkitAudioContext)();
                if (ctx.state === 'suspended') ctx.resume();

                // large fftSize for pitch detection
                const analyser = ctx.createAnalyser();
                analyser.fftSize = 2048;
                ctx.createMediaStreamSource(stream).connect(analyser);
                const freqData = new Uint8Array(analyser.frequencyBinCount);
                const timeData = new Float32Array(analyser.fftSize);

                // autocorrelation pitch detection
                function detectPitch () {
                    analyser.getFloatTimeDomainData(timeData);
                    const SIZE = timeData.length;
                    let r = new Array(SIZE).fill(0);
                    for (let lag = 0; lag < SIZE; lag++) {
                        for (let i = 0; i < SIZE - lag; i++) {
                            r[lag] += timeData[i] * timeData[i + lag];
                        }
                    }
                    let firstNeg = 0;
                    while (firstNeg < SIZE - 1 && r[firstNeg] > 0) firstNeg++;
                    let peak = firstNeg, maxVal = -Infinity;
                    for (let i = firstNeg; i < SIZE; i++) {
                        if (r[i] > maxVal) { maxVal = r[i]; peak = i; }
                    }
                    const freq = ctx.sampleRate / peak;
                    return (freq > 60 && freq < 1200) ? freq : null;
                }

                // pitch → color  (low=warm/red, mid=violet, high=cyan/blue)
                function pitchToColor (freq) {
                    if (!freq) return null;
                    const lo = 80, hi = 1000;
                    const t = Math.max(0, Math.min(1, (Math.log(freq) - Math.log(lo)) / (Math.log(hi) - Math.log(lo))));
                    // hue: 0=red (low), 270=violet (mid), 180=cyan (high)
                    const hue = (1 - t) * 10 + t * 200;
                    const c = HSVtoRGB(hue / 360, 0.65, 0.85);
                    c.r *= 0.35;
                    c.g *= 0.35;
                    c.b *= 0.35;
                    return c;
                }

                function loop() {
                    requestAnimationFrame(loop);
                    analyser.getByteFrequencyData(freqData);
                    let sum = 0;
                    for (let i = 0; i < freqData.length; i++) sum += freqData[i];
                    const volume = sum / freqData.length / 255;
                    const now = performance.now();
                    if (volume > MIC_SENSITIVITY && now - lastFire > SPLAT_COOLDOWN) {
                        lastFire = now;
                        lastSoundTime = now;

                        if (window.__pitchAware) {
                            const freq = detectPitch();
                            const col = pitchToColor(freq);
                            if (col) {
                                // direct splat with pitch color at random canvas position
                                const x = 0.15 + Math.random() * 0.7;
                                const y = 0.15 + Math.random() * 0.7;
                                const angle = Math.random() * Math.PI * 2;
                                const force = config.SPLAT_FORCE * (volume * 4 + 0.5);
                                splat(x * canvas.width, y * canvas.height,
                                      Math.cos(angle) * force, Math.sin(angle) * force, col);
                            } else {
                                splatStack.push(1);
                            }
                        } else {
                            splatStack.push(1);
                        }
                    }
                }
                loop();
                console.log('🎸 mic + pitch detection active');
            })
            .catch(e => console.warn('mic blocked:', e));

        // idle drift
        setInterval(() => {
            const now = performance.now();
            if (now - lastSoundTime > nextIdleGap) {
                lastSoundTime = now;
                nextIdleGap = 12000 + Math.random() * 8000;
                splatStack.push(1);
            }
        }, 4000);
    });
});

// ============================
// CUSTOM PALETTE WIDGET (2–8 colours, add/remove)
// ============================
window.addEventListener('load', () => {
    // restore saved palette
    try {
        const saved = JSON.parse(localStorage.getItem('fluidPalette') || 'null');
        if (saved && Array.isArray(saved.colors) && saved.colors.length >= 2) {
            config.PALETTE = saved.colors;
            config.USE_PALETTE = !!saved.use;
        }
    } catch (e) {}

    function savePalette () {
        localStorage.setItem('fluidPalette', JSON.stringify({ use: config.USE_PALETTE, colors: config.PALETTE }));
    }

    // toggle button
    const paletteBtn = document.createElement('div');
    paletteBtn.innerHTML = '🎨';
    paletteBtn.style.position = 'fixed';
    paletteBtn.style.top = '14px';
    paletteBtn.style.right = '60px';
    paletteBtn.style.width = '38px';
    paletteBtn.style.height = '38px';
    paletteBtn.style.display = 'flex';
    paletteBtn.style.alignItems = 'center';
    paletteBtn.style.justifyContent = 'center';
    paletteBtn.style.fontSize = '16px';
    paletteBtn.style.background = 'rgba(16, 18, 22, 0.55)';
    paletteBtn.style.backdropFilter = 'blur(16px) saturate(160%)';
    paletteBtn.style.border = '1px solid rgba(255, 255, 255, 0.1)';
    paletteBtn.style.borderRadius = '50%';
    paletteBtn.style.cursor = 'pointer';
    paletteBtn.style.zIndex = '50';
    paletteBtn.style.userSelect = 'none';
    paletteBtn.style.boxShadow = '0 4px 16px rgba(0,0,0,0.2)';
    paletteBtn.style.transition = 'border-color 0.2s ease';
    paletteBtn.title = 'Colour palette';

    paletteBtn.addEventListener('mouseenter', () => {
        paletteBtn.style.borderColor = 'rgba(125, 224, 214, 0.5)';
    });
    paletteBtn.addEventListener('mouseleave', () => {
        paletteBtn.style.borderColor = 'rgba(255, 255, 255, 0.1)';
    });

    // panel
    const panel = document.createElement('div');
    panel.style.position = 'fixed';
    panel.style.top = '58px';
    panel.style.right = '14px';
    panel.style.width = '200px';
    panel.style.display = 'none';
    panel.style.flexDirection = 'column';
    panel.style.gap = '6px';
    panel.style.padding = '12px';
    panel.style.background = 'rgba(16, 18, 22, 0.55)';
    panel.style.backdropFilter = 'blur(16px) saturate(160%)';
    panel.style.border = '1px solid rgba(255, 255, 255, 0.08)';
    panel.style.borderRadius = '10px';
    panel.style.boxShadow = '0 8px 32px rgba(0,0,0,0.25)';
    panel.style.zIndex = '50';
    panel.style.fontFamily = "'Space Mono', monospace";
    panel.style.color = 'rgba(235, 235, 240, 0.85)';
    panel.style.fontSize = '11px';

    function makeRow (color, index) {
        const row = document.createElement('div');
        row.style.display = 'flex';
        row.style.alignItems = 'center';
        row.style.gap = '8px';

        const swatch = document.createElement('input');
        swatch.type = 'color';
        swatch.value = color;
        swatch.style.width = '32px';
        swatch.style.height = '24px';
        swatch.style.border = '1px solid rgba(255,255,255,0.15)';
        swatch.style.borderRadius = '4px';
        swatch.style.background = 'transparent';
        swatch.style.cursor = 'pointer';
        swatch.addEventListener('input', () => {
            config.PALETTE[index] = swatch.value;
            savePalette();
        });

        const label = document.createElement('div');
        label.textContent = 'colour ' + (index + 1);
        label.style.flex = '1';
        label.style.opacity = '0.7';

        row.appendChild(swatch);
        row.appendChild(label);

        if (config.PALETTE.length > 2) {
            const removeBtn = document.createElement('div');
            removeBtn.textContent = '✕';
            removeBtn.style.cursor = 'pointer';
            removeBtn.style.opacity = '0.4';
            removeBtn.style.fontSize = '11px';
            removeBtn.addEventListener('mouseenter', () => removeBtn.style.opacity = '1');
            removeBtn.addEventListener('mouseleave', () => removeBtn.style.opacity = '0.4');
            removeBtn.addEventListener('click', () => {
                config.PALETTE.splice(index, 1);
                savePalette();
                renderPalette();
            });
            row.appendChild(removeBtn);
        }

        return row;
    }

    function renderPalette () {
        panel.innerHTML = '';

        const toggleRow = document.createElement('label');
        toggleRow.style.display = 'flex';
        toggleRow.style.alignItems = 'center';
        toggleRow.style.gap = '8px';
        toggleRow.style.marginBottom = '4px';
        toggleRow.style.cursor = 'pointer';
        toggleRow.style.fontWeight = '700';
        toggleRow.style.letterSpacing = '0.05em';
        toggleRow.style.textTransform = 'uppercase';
        toggleRow.style.fontSize = '10px';

        const toggle = document.createElement('input');
        toggle.type = 'checkbox';
        toggle.checked = config.USE_PALETTE;
        toggle.addEventListener('change', () => {
            config.USE_PALETTE = toggle.checked;
            savePalette();
        });

        toggleRow.appendChild(toggle);
        toggleRow.appendChild(document.createTextNode('use custom colours'));
        panel.appendChild(toggleRow);

        config.PALETTE.forEach((c, i) => panel.appendChild(makeRow(c, i)));

        if (config.PALETTE.length < 8) {
            const addBtn = document.createElement('div');
            addBtn.textContent = '+ add colour';
            addBtn.style.marginTop = '4px';
            addBtn.style.padding = '6px';
            addBtn.style.textAlign = 'center';
            addBtn.style.border = '1px solid rgba(255,255,255,0.1)';
            addBtn.style.borderRadius = '6px';
            addBtn.style.cursor = 'pointer';
            addBtn.style.color = 'rgba(125, 224, 214, 0.9)';
            addBtn.style.fontSize = '10px';
            addBtn.style.letterSpacing = '0.05em';
            addBtn.style.textTransform = 'uppercase';
            addBtn.addEventListener('mouseenter', () => addBtn.style.background = 'rgba(125, 224, 214, 0.08)');
            addBtn.addEventListener('mouseleave', () => addBtn.style.background = 'transparent');
            addBtn.addEventListener('click', () => {
                const randomHex = '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0');
                config.PALETTE.push(randomHex);
                savePalette();
                renderPalette();
            });
            panel.appendChild(addBtn);
        }
    }

    renderPalette();

    paletteBtn.addEventListener('click', () => {
        panel.style.display = panel.style.display === 'none' ? 'flex' : 'none';
    });

    document.body.appendChild(paletteBtn);
    document.body.appendChild(panel);
});
