import { mat4 } from 'gl-matrix'

import CancelablePromise from '../util/CancelablePromise'


/**
 * Renders a texture in a WebGL canvas.
 */
export default class WebGLCanvas {

    private canvas: HTMLCanvasElement
    private gl: WebGLRenderingContext
    private internalFormat: number
    private src: string

    private baseTexture: Texture | null = null
    /** Translates from texture coordinates (-textureSize/2 .. textureSize/2) to canvas coordinates (-canvasSize/2 .. canvasSize/2) */
    private baseTransformationMatrix: mat4
    private squarePositionBuffer: Buffer
    private transformationShader: TransformationShader


    constructor(width: number = 0, height: number = 0, internalFormat: number = WebGLRenderingContext.RGB) {
        this.internalFormat = internalFormat

        this.canvas = document.createElement('canvas')

        const gl = this.canvas.getContext('webgl2') as WebGLRenderingContext
        if (!gl) {
            throw new Error('Unable to initialize WebGL. Your browser or machine may not support it.')
        }
        this.gl = gl

        this.baseTransformationMatrix = mat4.create()

        // Create a vertex buffer for a square (a square from 0,0 to 1,1)
        const squarePositions = new Float32Array([
            // X, Y, Z, U, V
            0.0, 0.0, 0.0, 0.0, 0.0,
            1.0, 0.0, 0.0, 1.0, 0.0,
            0.0, 1.0, 0.0, 0.0, 1.0,
            1.0, 1.0, 0.0, 1.0, 1.0
        ])
        this.squarePositionBuffer = this.createBufferFromData(squarePositions, 5)

        this.transformationShader = new TransformationShader(gl)

        this.setSize(width, height)
    }

    getElement() {
        return this.canvas
    }

    setSize(width: number, height: number): this {
        this.canvas.width = width
        this.canvas.height = height

        this.gl.viewport(0, 0, width, height)

        // TODO: Create source and target textures

        return this
    }

    setBaseTexture(texture: Texture | null): this {
        if (this.baseTexture !== null) {
            this.baseTexture.destroy()
            this.baseTexture = null
        }
        this.baseTexture = texture

        return this
    }

    getBaseTexture(): Texture | null {
        return this.baseTexture
    }

    /**
     * Sets the transformation matrix which translates base texture coordinates (-textureSize/2 .. textureSize/2)
     * to canvas coordinates (-canvasSize/2 .. canvasSize/2).
     * 
     * Hint: Build your matrix backwards (last operation first)!
     * 
     * @param matrix the base transformation matrix
     */
    setBaseTransformationMatrix(matrix: mat4): this {
        this.baseTransformationMatrix = matrix
        return this
    }

    createBufferFromData(data: Float32Array, componentSize: number = 1): Buffer {
        const gl = this.gl
        const bufferId = gl.createBuffer()
        gl.bindBuffer(gl.ARRAY_BUFFER, bufferId)
        gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW)
        gl.bindBuffer(gl.ARRAY_BUFFER, null)
        return new Buffer(gl, bufferId, gl.FLOAT, componentSize, data.length / componentSize)
    }

    createTextureFromSrc(src: string, srcFormat: number = WebGLRenderingContext.RGB, srcType: number = WebGLRenderingContext.UNSIGNED_BYTE): CancelablePromise<Texture> {
        // For details see: https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/Tutorial/Using_textures_in_WebGL

        const gl = this.gl
        return new CancelablePromise<Texture>((resolve, reject) => {
            let image: HTMLImageElement | HTMLCanvasElement = new Image()
            image.onload = () => {
                const textureId = this.gl.createTexture()
                gl.bindTexture(gl.TEXTURE_2D, textureId)

                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_NEAREST)
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)

                gl.texImage2D(gl.TEXTURE_2D, 0, this.internalFormat, srcFormat, srcType, image)
                gl.generateMipmap(gl.TEXTURE_2D);
                gl.bindTexture(gl.TEXTURE_2D, null);

                resolve(new Texture(gl, textureId, image.width, image.height))
            }
            image.src = src
        })
    }

    update(): this {
        const canvas = this.canvas
        const gl = this.gl

        // Clear the canvas before we start drawing on it.
        // TODO: Make clear color configurable
        gl.clearColor(0.0, 0.0, 0.0, 1.0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        if (!this.baseTexture) {
            return this
        }

        // Important for matrix: Build it backwards (last operation first)
        const matrix = mat4.create()
        mat4.scale(matrix, matrix, [ 1 / (canvas.width / 2), -1 / (canvas.height / 2), 1 ])
            // Scale from from canvas coordinates (-canvasSize/2 .. canvasSize/2) to clipspace coordinates (-1 .. 1)
        mat4.multiply(matrix, matrix, this.baseTransformationMatrix)
        mat4.scale(matrix, matrix, [ this.baseTexture.width, this.baseTexture.height, 1 ])
            // Scale to texture coordinates (-textureSize/2 .. textureSize/2)
        mat4.translate(matrix, matrix, [ -0.5, -0.5, 0 ])
            // Move texture to the center

        this.transformationShader.draw(this.squarePositionBuffer, this.baseTexture, { uTransformationMatrix: matrix })

        return this
    }

}


export class Buffer {
    constructor(private gl: WebGLRenderingContext, public bufferId: WebGLBuffer, readonly type: number, readonly componentSize: number, readonly componentCount: number) {
    }

    bind() {
        const gl = this.gl
        gl.bindBuffer(gl.ARRAY_BUFFER, this.bufferId)
    }

    unbind() {
        const gl = this.gl
        gl.bindBuffer(gl.ARRAY_BUFFER, null)
    }

    /**
     * Sets this buffer as attribute for a vertex shader
     *
     * @param attribLocation the attribute location (from `gl.getAttribLocation`)
     * @param subsetSize the number of values to get - if only a subset of the component is needed (e.g. `2` if you need `u, v` from `x, y, z, u, v`)
     * @param subsetOffset the offset of the values to get - if only a subset of the component is needed (e.g. `3` if you need `u, v` from `x, y, z, u, v`)
     */
    setAsVertexAttrib(attribLocation: number, subsetSize?: number, subsetOffset?: number) {
        const gl = this.gl

        let size = this.componentSize
        let stride = 0
        let offset = 0
        if (subsetSize) {
            let bytesPerValue
            switch (this.type) {
                case gl.FLOAT: bytesPerValue = 4; break
                default: throw new Error(`Unknown buffer value type: ${this.type}`)
            }

            size = subsetSize
            stride = this.componentSize * bytesPerValue
            offset = (subsetOffset || 0) * bytesPerValue
        }

        this.bind()
        gl.vertexAttribPointer(attribLocation, size, this.type, false, stride, offset)
        gl.enableVertexAttribArray(attribLocation)
        this.unbind()
    }

}


export class Texture {

    constructor(private gl: WebGLRenderingContext, public textureId: WebGLTexture, readonly width: number, readonly height: number) {
    }

    destroy() {
        this.gl.deleteTexture(this.textureId)
        this.textureId = null
    }

    use(unit) {
        const gl = this.gl
        gl.activeTexture(gl.TEXTURE0 + unit)
        gl.bindTexture(gl.TEXTURE_2D, this.textureId)
    }

    unuse(unit) {
        const gl = this.gl
        gl.activeTexture(gl.TEXTURE0 + unit)
        gl.bindTexture(gl.TEXTURE_2D, null)
    }

}


type ShaderParameter = Texture | Float32Array | number

const defaultVertexShaderSource = `
    attribute vec4 aVertex;
    attribute vec2 aTextureCoord;

    varying highp vec2 vTextureCoord;

    void main() {
        gl_Position = aVertex;
        vTextureCoord = aTextureCoord;
    }`

const defaultFragmentShaderSource = `
    uniform sampler2D uSampler;

    varying highp vec2 vTextureCoord;

    void main(void) {
        gl_FragColor = texture2D(uSampler, vTextureCoord);
    }`

export class ShaderProgram<Uniforms extends { [key:string]:ShaderParameter }> {

    private programId: WebGLProgram
    private samplerUniformLocation: WebGLUniformLocation
    private vertexAttribLocation: number
    private textureCoordAttribLocation: number

    constructor(private gl: WebGLRenderingContext, vertexShaderSource: string = defaultVertexShaderSource, fragmentShaderSource: string = defaultFragmentShaderSource) {
        // For details see: https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/Tutorial/Adding_2D_content_to_a_WebGL_context

        const vertexShader = loadShader(gl, gl.VERTEX_SHADER, vertexShaderSource)
        const fragmentShader = loadShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource)

        // Create the shader program
        const programId = gl.createProgram()
        this.programId = programId
        gl.attachShader(programId, vertexShader)
        gl.attachShader(programId, fragmentShader)
        gl.linkProgram(programId)

        // Fail if creating the shader program failed
        if (!gl.getProgramParameter(programId, gl.LINK_STATUS)) {
            throw new Error('Unable to initialize the shader program: ' + gl.getProgramInfoLog(programId))
        }

        this.samplerUniformLocation = gl.getUniformLocation(programId, 'uSampler')
        this.vertexAttribLocation = gl.getAttribLocation(programId, 'aVertex')
        this.textureCoordAttribLocation = gl.getAttribLocation(programId, 'aTextureCoord')
    }

    draw(squarePositionBuffer: Buffer, sourceTexture: Texture, vertexUniforms: Uniforms) {
        const gl = this.gl

        gl.useProgram(this.programId)

        const textureUnit = 0
        sourceTexture.use(textureUnit)
        gl.uniform1i(this.samplerUniformLocation, textureUnit)

        squarePositionBuffer.setAsVertexAttrib(this.vertexAttribLocation, 3, 0)
        squarePositionBuffer.setAsVertexAttrib(this.textureCoordAttribLocation, 2, 3)

        for (var name of Object.keys(vertexUniforms)) {
            var location = gl.getUniformLocation(this.programId, name)
            if (location === null) continue // will be null if the uniform isn't used in the shader

            var value = vertexUniforms[name]
            if (value instanceof Texture) {
                gl.uniform1i(location, value.textureId as number)
            } else if (value instanceof Float32Array) {
                switch (value.length) {
                    case 1: gl.uniform1fv(location, value); break
                    case 2: gl.uniform2fv(location, value); break
                    case 3: gl.uniform3fv(location, value); break
                    case 4: gl.uniform4fv(location, value); break
                    case 9: gl.uniformMatrix3fv(location, false, value); break
                    case 16: gl.uniformMatrix4fv(location, false, value); break
                    default: throw new Error('Dont\'t know how to load uniform "' + name + '" of length ' + value.length)
                }
            } else if (typeof value === 'number') {
                gl.uniform1f(location, value)
            } else {
                throw new Error('Attempted to set uniform "' + name + '" to invalid value ' + (value || 'undefined').toString())
            }
        }

        gl.drawArrays(gl.TRIANGLE_STRIP, 0, squarePositionBuffer.componentCount)
    }
}


export class TransformationShader extends ShaderProgram<{ uTransformationMatrix: mat4 }> {
    constructor(gl: WebGLRenderingContext) {
        const vertexShaderSource = `
            uniform mat4 uTransformationMatrix;

            attribute vec4 aVertex;
            attribute vec2 aTextureCoord;

            varying highp vec2 vTextureCoord;

            void main() {
                gl_Position = uTransformationMatrix * aVertex;
                vTextureCoord = aTextureCoord;
            }`

        super(gl, vertexShaderSource, undefined)
    }
}


function isPowerOf2(value: number): boolean {
    return (value & (value - 1)) === 0
}


/**
 * Creates a shader of the given type, uploads the source and compiles it.
 */
function loadShader(gl: WebGLRenderingContext, type, source: string) {
    const shader = gl.createShader(type)
  
    // Send the source to the shader object
    gl.shaderSource(shader, source)
  
    // Compile the shader program
    gl.compileShader(shader)
  
    // See if it compiled successfully
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const msg = 'An error occurred compiling the shaders: ' + gl.getShaderInfoLog(shader)
        gl.deleteShader(shader)
        throw new Error(msg)
    }
  
    return shader
}
