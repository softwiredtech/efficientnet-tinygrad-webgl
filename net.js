
  function setupNet(gl, safetensor) {

    function createShaderProgram(gl, code) {
      const vertexShader = loadShader(gl, gl.VERTEX_SHADER, '#version 300 es\nin vec2 in_position;in vec2 in_uv;out vec2 uv;void main(){gl_Position=vec4(in_position,0.0,1.0);uv=in_uv;}');
      const fragmentShader = loadShader(gl, gl.FRAGMENT_SHADER, code);
      const shaderProgram = gl.createProgram();
      gl.attachShader(shaderProgram, vertexShader);
      gl.attachShader(shaderProgram, fragmentShader);
      gl.linkProgram(shaderProgram);

      if (!gl.getProgramParameter(shaderProgram, gl.LINK_STATUS)) {
        console.log(`Unable to initialize the shader program: ${gl.getProgramInfoLog(shaderProgram)}`);
        return null;
      }

      return shaderProgram;
    }

    function loadShader(gl, type, source) {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);

      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.log(`An error occurred compiling the shaders: ${gl.getShaderInfoLog(shader)}`);
        gl.deleteShader(shader);
        return null;
      }

      return shader;
    }

    function setupVertexData(gl, program, vertices) {
      let vao = gl.createVertexArray();
      gl.bindVertexArray(vao);

      let vertexBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);

      const positionLocation = gl.getAttribLocation(program, 'in_position');
      const uvLocation = gl.getAttribLocation(program, 'in_uv');
      
      gl.enableVertexAttribArray(positionLocation);
      gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 4 * 4, 0);

      gl.enableVertexAttribArray(uvLocation);
      gl.vertexAttribPointer(uvLocation, 2, gl.FLOAT, false, 4 * 4, 2 * 4);

      gl.bindVertexArray(null);

      return vao;
    }

    function runProgram(gl, kernelName, program, textures) {
      let framebuffer = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, textures[0].tex, 0);
      gl.useProgram(program);
      gl.uniform1i(gl.getUniformLocation(program, "w"), textures[0].width);  

      const vao = setupVertexData(gl, program, [-1, 1, 0, 1, -1, -1, 0, 0, 1, 1, 1, 1, 1, -1, 1, 0]);
      gl.bindVertexArray(vao);
      // Texture 0 is the framebuffer texture, so we skip that
      for (let i = 1; i < textures.length; i++) {
        gl.activeTexture(gl.TEXTURE0 + i-1);
        gl.bindTexture(gl.TEXTURE_2D, textures[i].tex);
        gl.uniform1i(gl.getUniformLocation(program, 'data' + i), i-1);
      }

      gl.viewport(0, 0, textures[0].width, textures[0].height);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);

      for (let i = 1; i < textures.length; i++) {
        gl.activeTexture(gl.TEXTURE0 + i-1);
        gl.bindTexture(gl.TEXTURE_2D, null);
      }

      console.log("Finished running: " + kernelName);
    }
    function limitTextureDims(size, threshold) {
      if (size <= threshold) { return [size, 1] };
      
      for (let i = 2; i < threshold + 1; i++) {
        if ((size % i == 0) && (Math.floor(size / i) <= threshold)) {
          return [Math.floor(size / i), i];
        }
      }
      
      return [size, 1];
    }

    function updateTextureData(gl, texture, data) {
      gl.bindTexture(gl.TEXTURE_2D, texture.tex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, texture.width, texture.height, gl.RED, gl.FLOAT, data);
      gl.bindTexture(gl.TEXTURE_2D, null);
    }

    function readTextureData(gl, texture) {
      const framebuffer = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture.tex, 0);

      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        throw new Error('Framebuffer not complete');
      }

      let data = new Float32Array(texture.width * texture.height);
      gl.readPixels(0, 0, texture.width, texture.height, gl.RED, gl.FLOAT, data);

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.deleteFramebuffer(framebuffer);

      console.log("Output: " + data);
      return data;
    }

    function createTexture(gl, size, tensorBuffer) {
      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      const internalFormat = gl.RGBA;
      const texSize = limitTextureDims(size, gl.getParameter(gl.MAX_TEXTURE_SIZE));
      let weights;
      
      if (tensorBuffer != null) {
        weights = new Float32Array(tensorBuffer.buffer, tensorBuffer.byteOffset, tensorBuffer.byteLength / Float32Array.BYTES_PER_ELEMENT);
      } else {
        weights = new Float32Array(size).fill(0.0);
      }

      if (size != weights.length)
        console.log("Weights length: " + weights.length + ", texsize: " + texSize[0]*texSize[1]);

      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, texSize[0], texSize[1], 0, gl.RED, gl.FLOAT, weights);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.bindTexture(gl.TEXTURE_2D, null);
      return { tex: texture, width: texSize[0], height: texSize[1] };
    } 

    const getTensorBuffer = (safetensorBuffer, tensorMetadata) => {
      return safetensorBuffer.subarray(...tensorMetadata.data_offsets);
    }

    const getTensorMetadata = (safetensorBuffer) => {
      const metadataLength = Number(new DataView(safetensorBuffer.buffer).getBigUint64(0, true));
      const metadata = JSON.parse(new TextDecoder("utf8").decode(safetensorBuffer.subarray(8, 8 + metadataLength)));
      return Object.fromEntries(Object.entries(metadata).filter(([k, v]) => k !== "__metadata__").map(([k, v]) => [k, {...v, data_offsets: v.data_offsets.map(x => 8 + metadataLength + x)}]));
    };

    const metadata = getTensorMetadata(safetensor);
  
const r_32_112_112_3_3_3 = `#version 300 es
precision highp float;
precision highp int;
in vec2 uv;
uniform int w;
uniform sampler2D data1;
uniform sampler2D data2;
uniform sampler2D data3;
uniform sampler2D data4;
uniform sampler2D data5;
uniform sampler2D data6;
out float out_data;

void main() {
  int idx0 = int(gl_FragCoord.y-0.5f) * w + int(gl_FragCoord.x-0.5f); /* 401408 */
  float acc0 = (0.0);
  for (int ridx0 = (0); ridx0 < (3); ++ridx0) {
    for (int ridx1 = (0); ridx1 < (3); ++ridx1) {
      for (int ridx2 = (0); ridx2 < (3); ++ridx2) {
        float val0 = bool((float((ridx2+((int(idx0)%int((112)))*(2)))<(224))*float((ridx1+((int((idx0/(112)))%int((112)))*(2)))<(224))))?(texture(data1, vec2(float(float(int(ridx2+((int(idx0)%int((112)))*(2))+(ridx1*(224))+((int((idx0/(112)))%int((112)))*(448))+(ridx0*(50176)))%textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).x), float(float(int(ridx2+((int(idx0)%int((112)))*(2))+(ridx1*(224))+((int((idx0/(112)))%int((112)))*(448))+(ridx0*(50176)))/textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).y))).r):(0.0);
        float val1 = texture(data2, vec2(float(float(int((ridx0*(9))+(ridx1*(3))+ridx2+((idx0/(12544))*(27)))%textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).x), float(float(int((ridx0*(9))+(ridx1*(3))+ridx2+((idx0/(12544))*(27)))/textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).y))).r;
        acc0 = ((val0*val1)+acc0);
      }
    }
  }
  float val2 = texture(data3, vec2(float(float(int(idx0/(12544))%textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).x), float(float(int(idx0/(12544))/textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).y))).r;
  float val3 = texture(data4, vec2(float(float(int(idx0/(12544))%textureSize(data4, 0).x) + 0.5f)/float(textureSize(data4, 0).x), float(float(int(idx0/(12544))/textureSize(data4, 0).x) + 0.5f)/float(textureSize(data4, 0).y))).r;
  float val4 = texture(data5, vec2(float(float(int(idx0/(12544))%textureSize(data5, 0).x) + 0.5f)/float(textureSize(data5, 0).x), float(float(int(idx0/(12544))/textureSize(data5, 0).x) + 0.5f)/float(textureSize(data5, 0).y))).r;
  float val5 = texture(data6, vec2(float(float(int(idx0/(12544))%textureSize(data6, 0).x) + 0.5f)/float(textureSize(data6, 0).x), float(float(int(idx0/(12544))/textureSize(data6, 0).x) + 0.5f)/float(textureSize(data6, 0).y))).r;
  float alu0 = float((((acc0-val2)*val3*sqrt(((1.0)/(val4+(1e-05)))))+val5));
  out_data = float((alu0*((1.0)/((1.0)+exp2((alu0*((-1.4426950408889634))))))));
}`;

const r_32_112_112_3_3 = `#version 300 es
precision highp float;
precision highp int;
in vec2 uv;
uniform int w;
uniform sampler2D data1;
uniform sampler2D data2;
out float out_data;

void main() {
  int idx0 = int(gl_FragCoord.y-0.5f) * w + int(gl_FragCoord.x-0.5f); /* 401408 */
  float acc0 = (0.0);
  for (int ridx0 = (0); ridx0 < (3); ++ridx0) {
    for (int ridx1 = (0); ridx1 < (3); ++ridx1) {
      float val0 = bool((float(((ridx1*((-1)))+((int(idx0)%int((112)))*((-1))))<(0))*float((ridx1+(int(idx0)%int((112))))<(113))*float(((ridx0*((-1)))+((int((idx0/(112)))%int((112)))*((-1))))<(0))*float((ridx0+(int((idx0/(112)))%int((112))))<(113))))?(texture(data1, vec2(float(float(int(ridx1+(int(idx0)%int((112)))+(ridx0*(112))+((int((idx0/(112)))%int((112)))*(112))+((idx0/(12544))*(12544))+((-113)))%textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).x), float(float(int(ridx1+(int(idx0)%int((112)))+(ridx0*(112))+((int((idx0/(112)))%int((112)))*(112))+((idx0/(12544))*(12544))+((-113)))/textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).y))).r):(0.0);
      float val1 = texture(data2, vec2(float(float(int((ridx0*(3))+ridx1+((idx0/(12544))*(9)))%textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).x), float(float(int((ridx0*(3))+ridx1+((idx0/(12544))*(9)))/textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).y))).r;
      acc0 = ((val0*val1)+acc0);
    }
  }
  out_data = float(acc0);
}`;

const r_32_12544 = `#version 300 es
precision highp float;
precision highp int;
in vec2 uv;
uniform int w;
uniform sampler2D data1;
uniform sampler2D data2;
uniform sampler2D data3;
uniform sampler2D data4;
uniform sampler2D data5;
out float out_data;

void main() {
  int idx0 = int(gl_FragCoord.y-0.5f) * w + int(gl_FragCoord.x-0.5f); /* 32 */
  float acc0 = (0.0);
  for (int ridx0 = (0); ridx0 < (12544); ++ridx0) {
    float val0 = texture(data1, vec2(float(float(int((idx0*(12544))+ridx0)%textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).x), float(float(int((idx0*(12544))+ridx0)/textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).y))).r;
    float val1 = texture(data2, vec2(float(float(int(idx0)%textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).x), float(float(int(idx0)/textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).y))).r;
    float val2 = texture(data3, vec2(float(float(int(idx0)%textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).x), float(float(int(idx0)/textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).y))).r;
    float val3 = texture(data4, vec2(float(float(int(idx0)%textureSize(data4, 0).x) + 0.5f)/float(textureSize(data4, 0).x), float(float(int(idx0)/textureSize(data4, 0).x) + 0.5f)/float(textureSize(data4, 0).y))).r;
    float val4 = texture(data5, vec2(float(float(int(idx0)%textureSize(data5, 0).x) + 0.5f)/float(textureSize(data5, 0).x), float(float(int(idx0)/textureSize(data5, 0).x) + 0.5f)/float(textureSize(data5, 0).y))).r;
    float alu0 = float((((val0-val1)*val2*sqrt(((1.0)/(val3+(1e-05)))))+val4));
    acc0 = ((alu0*((1.0)/((1.0)+exp2((alu0*((-1.4426950408889634)))))))+acc0);
  }
  out_data = float((acc0*(7.971938775510203e-05)));
}`;

const r_8_32 = `#version 300 es
precision highp float;
precision highp int;
in vec2 uv;
uniform int w;
uniform sampler2D data1;
uniform sampler2D data2;
uniform sampler2D data3;
out float out_data;

void main() {
  int idx0 = int(gl_FragCoord.y-0.5f) * w + int(gl_FragCoord.x-0.5f); /* 8 */
  float acc0 = (0.0);
  for (int ridx0 = (0); ridx0 < (32); ++ridx0) {
    float val0 = texture(data1, vec2(float(float(int(ridx0)%textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).x), float(float(int(ridx0)/textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).y))).r;
    float val1 = texture(data2, vec2(float(float(int((idx0*(32))+ridx0)%textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).x), float(float(int((idx0*(32))+ridx0)/textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).y))).r;
    acc0 = ((val0*val1)+acc0);
  }
  float val2 = texture(data3, vec2(float(float(int(idx0)%textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).x), float(float(int(idx0)/textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).y))).r;
  float alu0 = float((acc0+val2));
  out_data = float((alu0*((1.0)/((1.0)+exp2((alu0*((-1.4426950408889634))))))));
}`;

const r_32_8 = `#version 300 es
precision highp float;
precision highp int;
in vec2 uv;
uniform int w;
uniform sampler2D data1;
uniform sampler2D data2;
uniform sampler2D data3;
out float out_data;

void main() {
  int idx0 = int(gl_FragCoord.y-0.5f) * w + int(gl_FragCoord.x-0.5f); /* 32 */
  float acc0 = (0.0);
  for (int ridx0 = (0); ridx0 < (8); ++ridx0) {
    float val0 = texture(data1, vec2(float(float(int(ridx0)%textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).x), float(float(int(ridx0)/textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).y))).r;
    float val1 = texture(data2, vec2(float(float(int((idx0*(8))+ridx0)%textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).x), float(float(int((idx0*(8))+ridx0)/textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).y))).r;
    acc0 = ((val0*val1)+acc0);
  }
  float val2 = texture(data3, vec2(float(float(int(idx0)%textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).x), float(float(int(idx0)/textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).y))).r;
  out_data = float(((1.0)/((1.0)+exp2(((acc0+val2)*((-1.4426950408889634)))))));
}`;

const r_32_112_112_3_3n1 = `#version 300 es
precision highp float;
precision highp int;
in vec2 uv;
uniform int w;
uniform sampler2D data1;
uniform sampler2D data2;
uniform sampler2D data3;
uniform sampler2D data4;
uniform sampler2D data5;
uniform sampler2D data6;
uniform sampler2D data7;
out float out_data;

void main() {
  int idx0 = int(gl_FragCoord.y-0.5f) * w + int(gl_FragCoord.x-0.5f); /* 401408 */
  float acc0 = (0.0);
  for (int ridx0 = (0); ridx0 < (3); ++ridx0) {
    for (int ridx1 = (0); ridx1 < (3); ++ridx1) {
      float val0 = bool((float(((ridx1*((-1)))+((int(idx0)%int((112)))*((-1))))<(0))*float((ridx1+(int(idx0)%int((112))))<(113))*float(((ridx0*((-1)))+((int((idx0/(112)))%int((112)))*((-1))))<(0))*float((ridx0+(int((idx0/(112)))%int((112))))<(113))))?(texture(data1, vec2(float(float(int(ridx1+(int(idx0)%int((112)))+(ridx0*(112))+((int((idx0/(112)))%int((112)))*(112))+((idx0/(12544))*(12544))+((-113)))%textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).x), float(float(int(ridx1+(int(idx0)%int((112)))+(ridx0*(112))+((int((idx0/(112)))%int((112)))*(112))+((idx0/(12544))*(12544))+((-113)))/textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).y))).r):(0.0);
      float val1 = texture(data2, vec2(float(float(int((ridx0*(3))+ridx1+((idx0/(12544))*(9)))%textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).x), float(float(int((ridx0*(3))+ridx1+((idx0/(12544))*(9)))/textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).y))).r;
      acc0 = ((val0*val1)+acc0);
    }
  }
  float val2 = texture(data3, vec2(float(float(int(idx0/(12544))%textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).x), float(float(int(idx0/(12544))/textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).y))).r;
  float val3 = texture(data4, vec2(float(float(int(idx0/(12544))%textureSize(data4, 0).x) + 0.5f)/float(textureSize(data4, 0).x), float(float(int(idx0/(12544))/textureSize(data4, 0).x) + 0.5f)/float(textureSize(data4, 0).y))).r;
  float val4 = texture(data5, vec2(float(float(int(idx0/(12544))%textureSize(data5, 0).x) + 0.5f)/float(textureSize(data5, 0).x), float(float(int(idx0/(12544))/textureSize(data5, 0).x) + 0.5f)/float(textureSize(data5, 0).y))).r;
  float val5 = texture(data6, vec2(float(float(int(idx0/(12544))%textureSize(data6, 0).x) + 0.5f)/float(textureSize(data6, 0).x), float(float(int(idx0/(12544))/textureSize(data6, 0).x) + 0.5f)/float(textureSize(data6, 0).y))).r;
  float val6 = texture(data7, vec2(float(float(int(idx0/(12544))%textureSize(data7, 0).x) + 0.5f)/float(textureSize(data7, 0).x), float(float(int(idx0/(12544))/textureSize(data7, 0).x) + 0.5f)/float(textureSize(data7, 0).y))).r;
  float alu0 = float((((acc0-val2)*val3*sqrt(((1.0)/(val4+(1e-05)))))+val5));
  out_data = float((alu0*((1.0)/((1.0)+exp2((alu0*((-1.4426950408889634))))))*val6));
}`;

const r_16_12544_32 = `#version 300 es
precision highp float;
precision highp int;
in vec2 uv;
uniform int w;
uniform sampler2D data1;
uniform sampler2D data2;
uniform sampler2D data3;
uniform sampler2D data4;
uniform sampler2D data5;
uniform sampler2D data6;
out float out_data;

void main() {
  int idx0 = int(gl_FragCoord.y-0.5f) * w + int(gl_FragCoord.x-0.5f); /* 200704 */
  float acc0 = (0.0);
  for (int ridx0 = (0); ridx0 < (32); ++ridx0) {
    float val0 = texture(data1, vec2(float(float(int((ridx0*(12544))+(int(idx0)%int((12544))))%textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).x), float(float(int((ridx0*(12544))+(int(idx0)%int((12544))))/textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).y))).r;
    float val1 = texture(data2, vec2(float(float(int(ridx0+((idx0/(12544))*(32)))%textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).x), float(float(int(ridx0+((idx0/(12544))*(32)))/textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).y))).r;
    acc0 = ((val0*val1)+acc0);
  }
  float val2 = texture(data3, vec2(float(float(int(idx0/(12544))%textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).x), float(float(int(idx0/(12544))/textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).y))).r;
  float val3 = texture(data4, vec2(float(float(int(idx0/(12544))%textureSize(data4, 0).x) + 0.5f)/float(textureSize(data4, 0).x), float(float(int(idx0/(12544))/textureSize(data4, 0).x) + 0.5f)/float(textureSize(data4, 0).y))).r;
  float val4 = texture(data5, vec2(float(float(int(idx0/(12544))%textureSize(data5, 0).x) + 0.5f)/float(textureSize(data5, 0).x), float(float(int(idx0/(12544))/textureSize(data5, 0).x) + 0.5f)/float(textureSize(data5, 0).y))).r;
  float val5 = texture(data6, vec2(float(float(int(idx0/(12544))%textureSize(data6, 0).x) + 0.5f)/float(textureSize(data6, 0).x), float(float(int(idx0/(12544))/textureSize(data6, 0).x) + 0.5f)/float(textureSize(data6, 0).y))).r;
  out_data = float((((acc0-val2)*val3*sqrt(((1.0)/(val4+(1e-05)))))+val5));
}`;

const r_96_12544_16 = `#version 300 es
precision highp float;
precision highp int;
in vec2 uv;
uniform int w;
uniform sampler2D data1;
uniform sampler2D data2;
uniform sampler2D data3;
uniform sampler2D data4;
uniform sampler2D data5;
uniform sampler2D data6;
out float out_data;

void main() {
  int idx0 = int(gl_FragCoord.y-0.5f) * w + int(gl_FragCoord.x-0.5f); /* 1204224 */
  float acc0 = (0.0);
  for (int ridx0 = (0); ridx0 < (16); ++ridx0) {
    float val0 = texture(data1, vec2(float(float(int((ridx0*(12544))+(int(idx0)%int((12544))))%textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).x), float(float(int((ridx0*(12544))+(int(idx0)%int((12544))))/textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).y))).r;
    float val1 = texture(data2, vec2(float(float(int(ridx0+((idx0/(12544))*(16)))%textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).x), float(float(int(ridx0+((idx0/(12544))*(16)))/textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).y))).r;
    acc0 = ((val0*val1)+acc0);
  }
  float val2 = texture(data3, vec2(float(float(int(idx0/(12544))%textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).x), float(float(int(idx0/(12544))/textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).y))).r;
  float val3 = texture(data4, vec2(float(float(int(idx0/(12544))%textureSize(data4, 0).x) + 0.5f)/float(textureSize(data4, 0).x), float(float(int(idx0/(12544))/textureSize(data4, 0).x) + 0.5f)/float(textureSize(data4, 0).y))).r;
  float val4 = texture(data5, vec2(float(float(int(idx0/(12544))%textureSize(data5, 0).x) + 0.5f)/float(textureSize(data5, 0).x), float(float(int(idx0/(12544))/textureSize(data5, 0).x) + 0.5f)/float(textureSize(data5, 0).y))).r;
  float val5 = texture(data6, vec2(float(float(int(idx0/(12544))%textureSize(data6, 0).x) + 0.5f)/float(textureSize(data6, 0).x), float(float(int(idx0/(12544))/textureSize(data6, 0).x) + 0.5f)/float(textureSize(data6, 0).y))).r;
  float alu0 = float((((acc0-val2)*val3*sqrt(((1.0)/(val4+(1e-05)))))+val5));
  out_data = float((alu0*((1.0)/((1.0)+exp2((alu0*((-1.4426950408889634))))))));
}`;

const r_96_56_56_3_3 = `#version 300 es
precision highp float;
precision highp int;
in vec2 uv;
uniform int w;
uniform sampler2D data1;
uniform sampler2D data2;
out float out_data;

void main() {
  int idx0 = int(gl_FragCoord.y-0.5f) * w + int(gl_FragCoord.x-0.5f); /* 301056 */
  float acc0 = (0.0);
  for (int ridx0 = (0); ridx0 < (3); ++ridx0) {
    for (int ridx1 = (0); ridx1 < (3); ++ridx1) {
      float val0 = bool((float((ridx1+((int(idx0)%int((56)))*(2)))<(112))*float((ridx0+((int((idx0/(56)))%int((56)))*(2)))<(112))))?(texture(data1, vec2(float(float(int(ridx1+((int(idx0)%int((56)))*(2))+(ridx0*(112))+((int((idx0/(56)))%int((56)))*(224))+((idx0/(3136))*(12544)))%textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).x), float(float(int(ridx1+((int(idx0)%int((56)))*(2))+(ridx0*(112))+((int((idx0/(56)))%int((56)))*(224))+((idx0/(3136))*(12544)))/textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).y))).r):(0.0);
      float val1 = texture(data2, vec2(float(float(int((ridx0*(3))+ridx1+((idx0/(3136))*(9)))%textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).x), float(float(int((ridx0*(3))+ridx1+((idx0/(3136))*(9)))/textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).y))).r;
      acc0 = ((val0*val1)+acc0);
    }
  }
  out_data = float(acc0);
}`;

const r_96_3136 = `#version 300 es
precision highp float;
precision highp int;
in vec2 uv;
uniform int w;
uniform sampler2D data1;
uniform sampler2D data2;
uniform sampler2D data3;
uniform sampler2D data4;
uniform sampler2D data5;
out float out_data;

void main() {
  int idx0 = int(gl_FragCoord.y-0.5f) * w + int(gl_FragCoord.x-0.5f); /* 96 */
  float acc0 = (0.0);
  for (int ridx0 = (0); ridx0 < (3136); ++ridx0) {
    float val0 = texture(data1, vec2(float(float(int((idx0*(3136))+ridx0)%textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).x), float(float(int((idx0*(3136))+ridx0)/textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).y))).r;
    float val1 = texture(data2, vec2(float(float(int(idx0)%textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).x), float(float(int(idx0)/textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).y))).r;
    float val2 = texture(data3, vec2(float(float(int(idx0)%textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).x), float(float(int(idx0)/textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).y))).r;
    float val3 = texture(data4, vec2(float(float(int(idx0)%textureSize(data4, 0).x) + 0.5f)/float(textureSize(data4, 0).x), float(float(int(idx0)/textureSize(data4, 0).x) + 0.5f)/float(textureSize(data4, 0).y))).r;
    float val4 = texture(data5, vec2(float(float(int(idx0)%textureSize(data5, 0).x) + 0.5f)/float(textureSize(data5, 0).x), float(float(int(idx0)/textureSize(data5, 0).x) + 0.5f)/float(textureSize(data5, 0).y))).r;
    float alu0 = float((((val0-val1)*val2*sqrt(((1.0)/(val3+(1e-05)))))+val4));
    acc0 = ((alu0*((1.0)/((1.0)+exp2((alu0*((-1.4426950408889634)))))))+acc0);
  }
  out_data = float((acc0*(0.00031887755102040814)));
}`;

const r_4_96 = `#version 300 es
precision highp float;
precision highp int;
in vec2 uv;
uniform int w;
uniform sampler2D data1;
uniform sampler2D data2;
uniform sampler2D data3;
out float out_data;

void main() {
  int idx0 = int(gl_FragCoord.y-0.5f) * w + int(gl_FragCoord.x-0.5f); /* 4 */
  float acc0 = (0.0);
  for (int ridx0 = (0); ridx0 < (96); ++ridx0) {
    float val0 = texture(data1, vec2(float(float(int(ridx0)%textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).x), float(float(int(ridx0)/textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).y))).r;
    float val1 = texture(data2, vec2(float(float(int((idx0*(96))+ridx0)%textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).x), float(float(int((idx0*(96))+ridx0)/textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).y))).r;
    acc0 = ((val0*val1)+acc0);
  }
  float val2 = texture(data3, vec2(float(float(int(idx0)%textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).x), float(float(int(idx0)/textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).y))).r;
  float alu0 = float((acc0+val2));
  out_data = float((alu0*((1.0)/((1.0)+exp2((alu0*((-1.4426950408889634))))))));
}`;

const r_96_4 = `#version 300 es
precision highp float;
precision highp int;
in vec2 uv;
uniform int w;
uniform sampler2D data1;
uniform sampler2D data2;
uniform sampler2D data3;
out float out_data;

void main() {
  int idx0 = int(gl_FragCoord.y-0.5f) * w + int(gl_FragCoord.x-0.5f); /* 96 */
  float acc0 = (0.0);
  for (int ridx0 = (0); ridx0 < (4); ++ridx0) {
    float val0 = texture(data1, vec2(float(float(int(ridx0)%textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).x), float(float(int(ridx0)/textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).y))).r;
    float val1 = texture(data2, vec2(float(float(int((idx0*(4))+ridx0)%textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).x), float(float(int((idx0*(4))+ridx0)/textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).y))).r;
    acc0 = ((val0*val1)+acc0);
  }
  float val2 = texture(data3, vec2(float(float(int(idx0)%textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).x), float(float(int(idx0)/textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).y))).r;
  out_data = float(((1.0)/((1.0)+exp2(((acc0+val2)*((-1.4426950408889634)))))));
}`;

const r_96_56_56_3_3n1 = `#version 300 es
precision highp float;
precision highp int;
in vec2 uv;
uniform int w;
uniform sampler2D data1;
uniform sampler2D data2;
uniform sampler2D data3;
uniform sampler2D data4;
uniform sampler2D data5;
uniform sampler2D data6;
uniform sampler2D data7;
out float out_data;

void main() {
  int idx0 = int(gl_FragCoord.y-0.5f) * w + int(gl_FragCoord.x-0.5f); /* 301056 */
  float acc0 = (0.0);
  for (int ridx0 = (0); ridx0 < (3); ++ridx0) {
    for (int ridx1 = (0); ridx1 < (3); ++ridx1) {
      float val0 = bool((float((ridx1+((int(idx0)%int((56)))*(2)))<(112))*float((ridx0+((int((idx0/(56)))%int((56)))*(2)))<(112))))?(texture(data1, vec2(float(float(int(ridx1+((int(idx0)%int((56)))*(2))+(ridx0*(112))+((int((idx0/(56)))%int((56)))*(224))+((idx0/(3136))*(12544)))%textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).x), float(float(int(ridx1+((int(idx0)%int((56)))*(2))+(ridx0*(112))+((int((idx0/(56)))%int((56)))*(224))+((idx0/(3136))*(12544)))/textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).y))).r):(0.0);
      float val1 = texture(data2, vec2(float(float(int((ridx0*(3))+ridx1+((idx0/(3136))*(9)))%textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).x), float(float(int((ridx0*(3))+ridx1+((idx0/(3136))*(9)))/textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).y))).r;
      acc0 = ((val0*val1)+acc0);
    }
  }
  float val2 = texture(data3, vec2(float(float(int(idx0/(3136))%textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).x), float(float(int(idx0/(3136))/textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).y))).r;
  float val3 = texture(data4, vec2(float(float(int(idx0/(3136))%textureSize(data4, 0).x) + 0.5f)/float(textureSize(data4, 0).x), float(float(int(idx0/(3136))/textureSize(data4, 0).x) + 0.5f)/float(textureSize(data4, 0).y))).r;
  float val4 = texture(data5, vec2(float(float(int(idx0/(3136))%textureSize(data5, 0).x) + 0.5f)/float(textureSize(data5, 0).x), float(float(int(idx0/(3136))/textureSize(data5, 0).x) + 0.5f)/float(textureSize(data5, 0).y))).r;
  float val5 = texture(data6, vec2(float(float(int(idx0/(3136))%textureSize(data6, 0).x) + 0.5f)/float(textureSize(data6, 0).x), float(float(int(idx0/(3136))/textureSize(data6, 0).x) + 0.5f)/float(textureSize(data6, 0).y))).r;
  float val6 = texture(data7, vec2(float(float(int(idx0/(3136))%textureSize(data7, 0).x) + 0.5f)/float(textureSize(data7, 0).x), float(float(int(idx0/(3136))/textureSize(data7, 0).x) + 0.5f)/float(textureSize(data7, 0).y))).r;
  float alu0 = float((((acc0-val2)*val3*sqrt(((1.0)/(val4+(1e-05)))))+val5));
  out_data = float((alu0*((1.0)/((1.0)+exp2((alu0*((-1.4426950408889634))))))*val6));
}`;

const r_24_3136_96 = `#version 300 es
precision highp float;
precision highp int;
in vec2 uv;
uniform int w;
uniform sampler2D data1;
uniform sampler2D data2;
uniform sampler2D data3;
uniform sampler2D data4;
uniform sampler2D data5;
uniform sampler2D data6;
out float out_data;

void main() {
  int idx0 = int(gl_FragCoord.y-0.5f) * w + int(gl_FragCoord.x-0.5f); /* 75264 */
  float acc0 = (0.0);
  for (int ridx0 = (0); ridx0 < (96); ++ridx0) {
    float val0 = texture(data1, vec2(float(float(int((ridx0*(3136))+(int(idx0)%int((3136))))%textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).x), float(float(int((ridx0*(3136))+(int(idx0)%int((3136))))/textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).y))).r;
    float val1 = texture(data2, vec2(float(float(int(ridx0+((idx0/(3136))*(96)))%textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).x), float(float(int(ridx0+((idx0/(3136))*(96)))/textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).y))).r;
    acc0 = ((val0*val1)+acc0);
  }
  float val2 = texture(data3, vec2(float(float(int(idx0/(3136))%textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).x), float(float(int(idx0/(3136))/textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).y))).r;
  float val3 = texture(data4, vec2(float(float(int(idx0/(3136))%textureSize(data4, 0).x) + 0.5f)/float(textureSize(data4, 0).x), float(float(int(idx0/(3136))/textureSize(data4, 0).x) + 0.5f)/float(textureSize(data4, 0).y))).r;
  float val4 = texture(data5, vec2(float(float(int(idx0/(3136))%textureSize(data5, 0).x) + 0.5f)/float(textureSize(data5, 0).x), float(float(int(idx0/(3136))/textureSize(data5, 0).x) + 0.5f)/float(textureSize(data5, 0).y))).r;
  float val5 = texture(data6, vec2(float(float(int(idx0/(3136))%textureSize(data6, 0).x) + 0.5f)/float(textureSize(data6, 0).x), float(float(int(idx0/(3136))/textureSize(data6, 0).x) + 0.5f)/float(textureSize(data6, 0).y))).r;
  out_data = float((((acc0-val2)*val3*sqrt(((1.0)/(val4+(1e-05)))))+val5));
}`;

const r_144_3136_24 = `#version 300 es
precision highp float;
precision highp int;
in vec2 uv;
uniform int w;
uniform sampler2D data1;
uniform sampler2D data2;
uniform sampler2D data3;
uniform sampler2D data4;
uniform sampler2D data5;
uniform sampler2D data6;
out float out_data;

void main() {
  int idx0 = int(gl_FragCoord.y-0.5f) * w + int(gl_FragCoord.x-0.5f); /* 451584 */
  float acc0 = (0.0);
  for (int ridx0 = (0); ridx0 < (24); ++ridx0) {
    float val0 = texture(data1, vec2(float(float(int((ridx0*(3136))+(int(idx0)%int((3136))))%textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).x), float(float(int((ridx0*(3136))+(int(idx0)%int((3136))))/textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).y))).r;
    float val1 = texture(data2, vec2(float(float(int(ridx0+((idx0/(3136))*(24)))%textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).x), float(float(int(ridx0+((idx0/(3136))*(24)))/textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).y))).r;
    acc0 = ((val0*val1)+acc0);
  }
  float val2 = texture(data3, vec2(float(float(int(idx0/(3136))%textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).x), float(float(int(idx0/(3136))/textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).y))).r;
  float val3 = texture(data4, vec2(float(float(int(idx0/(3136))%textureSize(data4, 0).x) + 0.5f)/float(textureSize(data4, 0).x), float(float(int(idx0/(3136))/textureSize(data4, 0).x) + 0.5f)/float(textureSize(data4, 0).y))).r;
  float val4 = texture(data5, vec2(float(float(int(idx0/(3136))%textureSize(data5, 0).x) + 0.5f)/float(textureSize(data5, 0).x), float(float(int(idx0/(3136))/textureSize(data5, 0).x) + 0.5f)/float(textureSize(data5, 0).y))).r;
  float val5 = texture(data6, vec2(float(float(int(idx0/(3136))%textureSize(data6, 0).x) + 0.5f)/float(textureSize(data6, 0).x), float(float(int(idx0/(3136))/textureSize(data6, 0).x) + 0.5f)/float(textureSize(data6, 0).y))).r;
  float alu0 = float((((acc0-val2)*val3*sqrt(((1.0)/(val4+(1e-05)))))+val5));
  out_data = float((alu0*((1.0)/((1.0)+exp2((alu0*((-1.4426950408889634))))))));
}`;

const r_144_56_56_3_3 = `#version 300 es
precision highp float;
precision highp int;
in vec2 uv;
uniform int w;
uniform sampler2D data1;
uniform sampler2D data2;
out float out_data;

void main() {
  int idx0 = int(gl_FragCoord.y-0.5f) * w + int(gl_FragCoord.x-0.5f); /* 451584 */
  float acc0 = (0.0);
  for (int ridx0 = (0); ridx0 < (3); ++ridx0) {
    for (int ridx1 = (0); ridx1 < (3); ++ridx1) {
      float val0 = bool((float(((ridx1*((-1)))+((int(idx0)%int((56)))*((-1))))<(0))*float((ridx1+(int(idx0)%int((56))))<(57))*float(((ridx0*((-1)))+((int((idx0/(56)))%int((56)))*((-1))))<(0))*float((ridx0+(int((idx0/(56)))%int((56))))<(57))))?(texture(data1, vec2(float(float(int(ridx1+(int(idx0)%int((56)))+(ridx0*(56))+((int((idx0/(56)))%int((56)))*(56))+((idx0/(3136))*(3136))+((-57)))%textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).x), float(float(int(ridx1+(int(idx0)%int((56)))+(ridx0*(56))+((int((idx0/(56)))%int((56)))*(56))+((idx0/(3136))*(3136))+((-57)))/textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).y))).r):(0.0);
      float val1 = texture(data2, vec2(float(float(int((ridx0*(3))+ridx1+((idx0/(3136))*(9)))%textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).x), float(float(int((ridx0*(3))+ridx1+((idx0/(3136))*(9)))/textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).y))).r;
      acc0 = ((val0*val1)+acc0);
    }
  }
  out_data = float(acc0);
}`;

const r_144_3136 = `#version 300 es
precision highp float;
precision highp int;
in vec2 uv;
uniform int w;
uniform sampler2D data1;
uniform sampler2D data2;
uniform sampler2D data3;
uniform sampler2D data4;
uniform sampler2D data5;
out float out_data;

void main() {
  int idx0 = int(gl_FragCoord.y-0.5f) * w + int(gl_FragCoord.x-0.5f); /* 144 */
  float acc0 = (0.0);
  for (int ridx0 = (0); ridx0 < (3136); ++ridx0) {
    float val0 = texture(data1, vec2(float(float(int((idx0*(3136))+ridx0)%textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).x), float(float(int((idx0*(3136))+ridx0)/textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).y))).r;
    float val1 = texture(data2, vec2(float(float(int(idx0)%textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).x), float(float(int(idx0)/textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).y))).r;
    float val2 = texture(data3, vec2(float(float(int(idx0)%textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).x), float(float(int(idx0)/textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).y))).r;
    float val3 = texture(data4, vec2(float(float(int(idx0)%textureSize(data4, 0).x) + 0.5f)/float(textureSize(data4, 0).x), float(float(int(idx0)/textureSize(data4, 0).x) + 0.5f)/float(textureSize(data4, 0).y))).r;
    float val4 = texture(data5, vec2(float(float(int(idx0)%textureSize(data5, 0).x) + 0.5f)/float(textureSize(data5, 0).x), float(float(int(idx0)/textureSize(data5, 0).x) + 0.5f)/float(textureSize(data5, 0).y))).r;
    float alu0 = float((((val0-val1)*val2*sqrt(((1.0)/(val3+(1e-05)))))+val4));
    acc0 = ((alu0*((1.0)/((1.0)+exp2((alu0*((-1.4426950408889634)))))))+acc0);
  }
  out_data = float((acc0*(0.00031887755102040814)));
}`;

const r_6_144 = `#version 300 es
precision highp float;
precision highp int;
in vec2 uv;
uniform int w;
uniform sampler2D data1;
uniform sampler2D data2;
uniform sampler2D data3;
out float out_data;

void main() {
  int idx0 = int(gl_FragCoord.y-0.5f) * w + int(gl_FragCoord.x-0.5f); /* 6 */
  float acc0 = (0.0);
  for (int ridx0 = (0); ridx0 < (144); ++ridx0) {
    float val0 = texture(data1, vec2(float(float(int(ridx0)%textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).x), float(float(int(ridx0)/textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).y))).r;
    float val1 = texture(data2, vec2(float(float(int((idx0*(144))+ridx0)%textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).x), float(float(int((idx0*(144))+ridx0)/textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).y))).r;
    acc0 = ((val0*val1)+acc0);
  }
  float val2 = texture(data3, vec2(float(float(int(idx0)%textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).x), float(float(int(idx0)/textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).y))).r;
  float alu0 = float((acc0+val2));
  out_data = float((alu0*((1.0)/((1.0)+exp2((alu0*((-1.4426950408889634))))))));
}`;

const r_144_6 = `#version 300 es
precision highp float;
precision highp int;
in vec2 uv;
uniform int w;
uniform sampler2D data1;
uniform sampler2D data2;
uniform sampler2D data3;
out float out_data;

void main() {
  int idx0 = int(gl_FragCoord.y-0.5f) * w + int(gl_FragCoord.x-0.5f); /* 144 */
  float acc0 = (0.0);
  for (int ridx0 = (0); ridx0 < (6); ++ridx0) {
    float val0 = texture(data1, vec2(float(float(int(ridx0)%textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).x), float(float(int(ridx0)/textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).y))).r;
    float val1 = texture(data2, vec2(float(float(int((idx0*(6))+ridx0)%textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).x), float(float(int((idx0*(6))+ridx0)/textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).y))).r;
    acc0 = ((val0*val1)+acc0);
  }
  float val2 = texture(data3, vec2(float(float(int(idx0)%textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).x), float(float(int(idx0)/textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).y))).r;
  out_data = float(((1.0)/((1.0)+exp2(((acc0+val2)*((-1.4426950408889634)))))));
}`;

const r_144_56_56_3_3n1 = `#version 300 es
precision highp float;
precision highp int;
in vec2 uv;
uniform int w;
uniform sampler2D data1;
uniform sampler2D data2;
uniform sampler2D data3;
uniform sampler2D data4;
uniform sampler2D data5;
uniform sampler2D data6;
uniform sampler2D data7;
out float out_data;

void main() {
  int idx0 = int(gl_FragCoord.y-0.5f) * w + int(gl_FragCoord.x-0.5f); /* 451584 */
  float acc0 = (0.0);
  for (int ridx0 = (0); ridx0 < (3); ++ridx0) {
    for (int ridx1 = (0); ridx1 < (3); ++ridx1) {
      float val0 = bool((float(((ridx1*((-1)))+((int(idx0)%int((56)))*((-1))))<(0))*float((ridx1+(int(idx0)%int((56))))<(57))*float(((ridx0*((-1)))+((int((idx0/(56)))%int((56)))*((-1))))<(0))*float((ridx0+(int((idx0/(56)))%int((56))))<(57))))?(texture(data1, vec2(float(float(int(ridx1+(int(idx0)%int((56)))+(ridx0*(56))+((int((idx0/(56)))%int((56)))*(56))+((idx0/(3136))*(3136))+((-57)))%textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).x), float(float(int(ridx1+(int(idx0)%int((56)))+(ridx0*(56))+((int((idx0/(56)))%int((56)))*(56))+((idx0/(3136))*(3136))+((-57)))/textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).y))).r):(0.0);
      float val1 = texture(data2, vec2(float(float(int((ridx0*(3))+ridx1+((idx0/(3136))*(9)))%textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).x), float(float(int((ridx0*(3))+ridx1+((idx0/(3136))*(9)))/textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).y))).r;
      acc0 = ((val0*val1)+acc0);
    }
  }
  float val2 = texture(data3, vec2(float(float(int(idx0/(3136))%textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).x), float(float(int(idx0/(3136))/textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).y))).r;
  float val3 = texture(data4, vec2(float(float(int(idx0/(3136))%textureSize(data4, 0).x) + 0.5f)/float(textureSize(data4, 0).x), float(float(int(idx0/(3136))/textureSize(data4, 0).x) + 0.5f)/float(textureSize(data4, 0).y))).r;
  float val4 = texture(data5, vec2(float(float(int(idx0/(3136))%textureSize(data5, 0).x) + 0.5f)/float(textureSize(data5, 0).x), float(float(int(idx0/(3136))/textureSize(data5, 0).x) + 0.5f)/float(textureSize(data5, 0).y))).r;
  float val5 = texture(data6, vec2(float(float(int(idx0/(3136))%textureSize(data6, 0).x) + 0.5f)/float(textureSize(data6, 0).x), float(float(int(idx0/(3136))/textureSize(data6, 0).x) + 0.5f)/float(textureSize(data6, 0).y))).r;
  float val6 = texture(data7, vec2(float(float(int(idx0/(3136))%textureSize(data7, 0).x) + 0.5f)/float(textureSize(data7, 0).x), float(float(int(idx0/(3136))/textureSize(data7, 0).x) + 0.5f)/float(textureSize(data7, 0).y))).r;
  float alu0 = float((((acc0-val2)*val3*sqrt(((1.0)/(val4+(1e-05)))))+val5));
  out_data = float((alu0*((1.0)/((1.0)+exp2((alu0*((-1.4426950408889634))))))*val6));
}`;

const r_24_3136_144 = `#version 300 es
precision highp float;
precision highp int;
in vec2 uv;
uniform int w;
uniform sampler2D data1;
uniform sampler2D data2;
uniform sampler2D data3;
uniform sampler2D data4;
uniform sampler2D data5;
uniform sampler2D data6;
uniform sampler2D data7;
out float out_data;

void main() {
  int idx0 = int(gl_FragCoord.y-0.5f) * w + int(gl_FragCoord.x-0.5f); /* 75264 */
  float acc0 = (0.0);
  for (int ridx0 = (0); ridx0 < (144); ++ridx0) {
    float val0 = texture(data1, vec2(float(float(int((ridx0*(3136))+(int(idx0)%int((3136))))%textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).x), float(float(int((ridx0*(3136))+(int(idx0)%int((3136))))/textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).y))).r;
    float val1 = texture(data2, vec2(float(float(int(ridx0+((idx0/(3136))*(144)))%textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).x), float(float(int(ridx0+((idx0/(3136))*(144)))/textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).y))).r;
    acc0 = ((val0*val1)+acc0);
  }
  float val2 = texture(data3, vec2(float(float(int(idx0/(3136))%textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).x), float(float(int(idx0/(3136))/textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).y))).r;
  float val3 = texture(data4, vec2(float(float(int(idx0/(3136))%textureSize(data4, 0).x) + 0.5f)/float(textureSize(data4, 0).x), float(float(int(idx0/(3136))/textureSize(data4, 0).x) + 0.5f)/float(textureSize(data4, 0).y))).r;
  float val4 = texture(data5, vec2(float(float(int(idx0/(3136))%textureSize(data5, 0).x) + 0.5f)/float(textureSize(data5, 0).x), float(float(int(idx0/(3136))/textureSize(data5, 0).x) + 0.5f)/float(textureSize(data5, 0).y))).r;
  float val5 = texture(data6, vec2(float(float(int(idx0/(3136))%textureSize(data6, 0).x) + 0.5f)/float(textureSize(data6, 0).x), float(float(int(idx0/(3136))/textureSize(data6, 0).x) + 0.5f)/float(textureSize(data6, 0).y))).r;
  float val6 = texture(data7, vec2(float(float(int(idx0)%textureSize(data7, 0).x) + 0.5f)/float(textureSize(data7, 0).x), float(float(int(idx0)/textureSize(data7, 0).x) + 0.5f)/float(textureSize(data7, 0).y))).r;
  out_data = float((((acc0-val2)*val3*sqrt(((1.0)/(val4+(1e-05)))))+val5+val6));
}`;

const r_144_28_28_5_5 = `#version 300 es
precision highp float;
precision highp int;
in vec2 uv;
uniform int w;
uniform sampler2D data1;
uniform sampler2D data2;
out float out_data;

void main() {
  int idx0 = int(gl_FragCoord.y-0.5f) * w + int(gl_FragCoord.x-0.5f); /* 112896 */
  float acc0 = (0.0);
  for (int ridx0 = (0); ridx0 < (5); ++ridx0) {
    for (int ridx1 = (0); ridx1 < (5); ++ridx1) {
      float val0 = bool((float(((ridx1*((-1)))+((int(idx0)%int((28)))*((-2))))<(0))*float((ridx1+((int(idx0)%int((28)))*(2)))<(57))*float(((ridx0*((-1)))+((int((idx0/(28)))%int((28)))*((-2))))<(0))*float((ridx0+((int((idx0/(28)))%int((28)))*(2)))<(57))))?(texture(data1, vec2(float(float(int(ridx1+((int(idx0)%int((28)))*(2))+(ridx0*(56))+((int((idx0/(28)))%int((28)))*(112))+((idx0/(784))*(3136))+((-57)))%textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).x), float(float(int(ridx1+((int(idx0)%int((28)))*(2))+(ridx0*(56))+((int((idx0/(28)))%int((28)))*(112))+((idx0/(784))*(3136))+((-57)))/textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).y))).r):(0.0);
      float val1 = texture(data2, vec2(float(float(int((ridx0*(5))+ridx1+((idx0/(784))*(25)))%textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).x), float(float(int((ridx0*(5))+ridx1+((idx0/(784))*(25)))/textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).y))).r;
      acc0 = ((val0*val1)+acc0);
    }
  }
  out_data = float(acc0);
}`;

const r_144_784 = `#version 300 es
precision highp float;
precision highp int;
in vec2 uv;
uniform int w;
uniform sampler2D data1;
uniform sampler2D data2;
uniform sampler2D data3;
uniform sampler2D data4;
uniform sampler2D data5;
out float out_data;

void main() {
  int idx0 = int(gl_FragCoord.y-0.5f) * w + int(gl_FragCoord.x-0.5f); /* 144 */
  float acc0 = (0.0);
  for (int ridx0 = (0); ridx0 < (784); ++ridx0) {
    float val0 = texture(data1, vec2(float(float(int((idx0*(784))+ridx0)%textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).x), float(float(int((idx0*(784))+ridx0)/textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).y))).r;
    float val1 = texture(data2, vec2(float(float(int(idx0)%textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).x), float(float(int(idx0)/textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).y))).r;
    float val2 = texture(data3, vec2(float(float(int(idx0)%textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).x), float(float(int(idx0)/textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).y))).r;
    float val3 = texture(data4, vec2(float(float(int(idx0)%textureSize(data4, 0).x) + 0.5f)/float(textureSize(data4, 0).x), float(float(int(idx0)/textureSize(data4, 0).x) + 0.5f)/float(textureSize(data4, 0).y))).r;
    float val4 = texture(data5, vec2(float(float(int(idx0)%textureSize(data5, 0).x) + 0.5f)/float(textureSize(data5, 0).x), float(float(int(idx0)/textureSize(data5, 0).x) + 0.5f)/float(textureSize(data5, 0).y))).r;
    float alu0 = float((((val0-val1)*val2*sqrt(((1.0)/(val3+(1e-05)))))+val4));
    acc0 = ((alu0*((1.0)/((1.0)+exp2((alu0*((-1.4426950408889634)))))))+acc0);
  }
  out_data = float((acc0*(0.0012755102040816326)));
}`;

const r_144_28_28_5_5n1 = `#version 300 es
precision highp float;
precision highp int;
in vec2 uv;
uniform int w;
uniform sampler2D data1;
uniform sampler2D data2;
uniform sampler2D data3;
uniform sampler2D data4;
uniform sampler2D data5;
uniform sampler2D data6;
uniform sampler2D data7;
out float out_data;

void main() {
  int idx0 = int(gl_FragCoord.y-0.5f) * w + int(gl_FragCoord.x-0.5f); /* 112896 */
  float acc0 = (0.0);
  for (int ridx0 = (0); ridx0 < (5); ++ridx0) {
    for (int ridx1 = (0); ridx1 < (5); ++ridx1) {
      float val0 = bool((float(((ridx1*((-1)))+((int(idx0)%int((28)))*((-2))))<(0))*float((ridx1+((int(idx0)%int((28)))*(2)))<(57))*float(((ridx0*((-1)))+((int((idx0/(28)))%int((28)))*((-2))))<(0))*float((ridx0+((int((idx0/(28)))%int((28)))*(2)))<(57))))?(texture(data1, vec2(float(float(int(ridx1+((int(idx0)%int((28)))*(2))+(ridx0*(56))+((int((idx0/(28)))%int((28)))*(112))+((idx0/(784))*(3136))+((-57)))%textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).x), float(float(int(ridx1+((int(idx0)%int((28)))*(2))+(ridx0*(56))+((int((idx0/(28)))%int((28)))*(112))+((idx0/(784))*(3136))+((-57)))/textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).y))).r):(0.0);
      float val1 = texture(data2, vec2(float(float(int((ridx0*(5))+ridx1+((idx0/(784))*(25)))%textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).x), float(float(int((ridx0*(5))+ridx1+((idx0/(784))*(25)))/textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).y))).r;
      acc0 = ((val0*val1)+acc0);
    }
  }
  float val2 = texture(data3, vec2(float(float(int(idx0/(784))%textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).x), float(float(int(idx0/(784))/textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).y))).r;
  float val3 = texture(data4, vec2(float(float(int(idx0/(784))%textureSize(data4, 0).x) + 0.5f)/float(textureSize(data4, 0).x), float(float(int(idx0/(784))/textureSize(data4, 0).x) + 0.5f)/float(textureSize(data4, 0).y))).r;
  float val4 = texture(data5, vec2(float(float(int(idx0/(784))%textureSize(data5, 0).x) + 0.5f)/float(textureSize(data5, 0).x), float(float(int(idx0/(784))/textureSize(data5, 0).x) + 0.5f)/float(textureSize(data5, 0).y))).r;
  float val5 = texture(data6, vec2(float(float(int(idx0/(784))%textureSize(data6, 0).x) + 0.5f)/float(textureSize(data6, 0).x), float(float(int(idx0/(784))/textureSize(data6, 0).x) + 0.5f)/float(textureSize(data6, 0).y))).r;
  float val6 = texture(data7, vec2(float(float(int(idx0/(784))%textureSize(data7, 0).x) + 0.5f)/float(textureSize(data7, 0).x), float(float(int(idx0/(784))/textureSize(data7, 0).x) + 0.5f)/float(textureSize(data7, 0).y))).r;
  float alu0 = float((((acc0-val2)*val3*sqrt(((1.0)/(val4+(1e-05)))))+val5));
  out_data = float((alu0*((1.0)/((1.0)+exp2((alu0*((-1.4426950408889634))))))*val6));
}`;

const r_40_784_144 = `#version 300 es
precision highp float;
precision highp int;
in vec2 uv;
uniform int w;
uniform sampler2D data1;
uniform sampler2D data2;
uniform sampler2D data3;
uniform sampler2D data4;
uniform sampler2D data5;
uniform sampler2D data6;
out float out_data;

void main() {
  int idx0 = int(gl_FragCoord.y-0.5f) * w + int(gl_FragCoord.x-0.5f); /* 31360 */
  float acc0 = (0.0);
  for (int ridx0 = (0); ridx0 < (144); ++ridx0) {
    float val0 = texture(data1, vec2(float(float(int((ridx0*(784))+(int(idx0)%int((784))))%textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).x), float(float(int((ridx0*(784))+(int(idx0)%int((784))))/textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).y))).r;
    float val1 = texture(data2, vec2(float(float(int(ridx0+((idx0/(784))*(144)))%textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).x), float(float(int(ridx0+((idx0/(784))*(144)))/textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).y))).r;
    acc0 = ((val0*val1)+acc0);
  }
  float val2 = texture(data3, vec2(float(float(int(idx0/(784))%textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).x), float(float(int(idx0/(784))/textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).y))).r;
  float val3 = texture(data4, vec2(float(float(int(idx0/(784))%textureSize(data4, 0).x) + 0.5f)/float(textureSize(data4, 0).x), float(float(int(idx0/(784))/textureSize(data4, 0).x) + 0.5f)/float(textureSize(data4, 0).y))).r;
  float val4 = texture(data5, vec2(float(float(int(idx0/(784))%textureSize(data5, 0).x) + 0.5f)/float(textureSize(data5, 0).x), float(float(int(idx0/(784))/textureSize(data5, 0).x) + 0.5f)/float(textureSize(data5, 0).y))).r;
  float val5 = texture(data6, vec2(float(float(int(idx0/(784))%textureSize(data6, 0).x) + 0.5f)/float(textureSize(data6, 0).x), float(float(int(idx0/(784))/textureSize(data6, 0).x) + 0.5f)/float(textureSize(data6, 0).y))).r;
  out_data = float((((acc0-val2)*val3*sqrt(((1.0)/(val4+(1e-05)))))+val5));
}`;

const r_240_784_40 = `#version 300 es
precision highp float;
precision highp int;
in vec2 uv;
uniform int w;
uniform sampler2D data1;
uniform sampler2D data2;
uniform sampler2D data3;
uniform sampler2D data4;
uniform sampler2D data5;
uniform sampler2D data6;
out float out_data;

void main() {
  int idx0 = int(gl_FragCoord.y-0.5f) * w + int(gl_FragCoord.x-0.5f); /* 188160 */
  float acc0 = (0.0);
  for (int ridx0 = (0); ridx0 < (40); ++ridx0) {
    float val0 = texture(data1, vec2(float(float(int((ridx0*(784))+(int(idx0)%int((784))))%textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).x), float(float(int((ridx0*(784))+(int(idx0)%int((784))))/textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).y))).r;
    float val1 = texture(data2, vec2(float(float(int(ridx0+((idx0/(784))*(40)))%textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).x), float(float(int(ridx0+((idx0/(784))*(40)))/textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).y))).r;
    acc0 = ((val0*val1)+acc0);
  }
  float val2 = texture(data3, vec2(float(float(int(idx0/(784))%textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).x), float(float(int(idx0/(784))/textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).y))).r;
  float val3 = texture(data4, vec2(float(float(int(idx0/(784))%textureSize(data4, 0).x) + 0.5f)/float(textureSize(data4, 0).x), float(float(int(idx0/(784))/textureSize(data4, 0).x) + 0.5f)/float(textureSize(data4, 0).y))).r;
  float val4 = texture(data5, vec2(float(float(int(idx0/(784))%textureSize(data5, 0).x) + 0.5f)/float(textureSize(data5, 0).x), float(float(int(idx0/(784))/textureSize(data5, 0).x) + 0.5f)/float(textureSize(data5, 0).y))).r;
  float val5 = texture(data6, vec2(float(float(int(idx0/(784))%textureSize(data6, 0).x) + 0.5f)/float(textureSize(data6, 0).x), float(float(int(idx0/(784))/textureSize(data6, 0).x) + 0.5f)/float(textureSize(data6, 0).y))).r;
  float alu0 = float((((acc0-val2)*val3*sqrt(((1.0)/(val4+(1e-05)))))+val5));
  out_data = float((alu0*((1.0)/((1.0)+exp2((alu0*((-1.4426950408889634))))))));
}`;

const r_240_28_28_5_5 = `#version 300 es
precision highp float;
precision highp int;
in vec2 uv;
uniform int w;
uniform sampler2D data1;
uniform sampler2D data2;
out float out_data;

void main() {
  int idx0 = int(gl_FragCoord.y-0.5f) * w + int(gl_FragCoord.x-0.5f); /* 188160 */
  float acc0 = (0.0);
  for (int ridx0 = (0); ridx0 < (5); ++ridx0) {
    for (int ridx1 = (0); ridx1 < (5); ++ridx1) {
      float val0 = bool((float(((ridx1*((-1)))+((int(idx0)%int((28)))*((-1))))<((-1)))*float((ridx1+(int(idx0)%int((28))))<(30))*float(((ridx0*((-1)))+((int((idx0/(28)))%int((28)))*((-1))))<((-1)))*float((ridx0+(int((idx0/(28)))%int((28))))<(30))))?(texture(data1, vec2(float(float(int(ridx1+(int(idx0)%int((28)))+(ridx0*(28))+((int((idx0/(28)))%int((28)))*(28))+((idx0/(784))*(784))+((-58)))%textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).x), float(float(int(ridx1+(int(idx0)%int((28)))+(ridx0*(28))+((int((idx0/(28)))%int((28)))*(28))+((idx0/(784))*(784))+((-58)))/textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).y))).r):(0.0);
      float val1 = texture(data2, vec2(float(float(int((ridx0*(5))+ridx1+((idx0/(784))*(25)))%textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).x), float(float(int((ridx0*(5))+ridx1+((idx0/(784))*(25)))/textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).y))).r;
      acc0 = ((val0*val1)+acc0);
    }
  }
  out_data = float(acc0);
}`;

const r_240_784 = `#version 300 es
precision highp float;
precision highp int;
in vec2 uv;
uniform int w;
uniform sampler2D data1;
uniform sampler2D data2;
uniform sampler2D data3;
uniform sampler2D data4;
uniform sampler2D data5;
out float out_data;

void main() {
  int idx0 = int(gl_FragCoord.y-0.5f) * w + int(gl_FragCoord.x-0.5f); /* 240 */
  float acc0 = (0.0);
  for (int ridx0 = (0); ridx0 < (784); ++ridx0) {
    float val0 = texture(data1, vec2(float(float(int((idx0*(784))+ridx0)%textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).x), float(float(int((idx0*(784))+ridx0)/textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).y))).r;
    float val1 = texture(data2, vec2(float(float(int(idx0)%textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).x), float(float(int(idx0)/textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).y))).r;
    float val2 = texture(data3, vec2(float(float(int(idx0)%textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).x), float(float(int(idx0)/textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).y))).r;
    float val3 = texture(data4, vec2(float(float(int(idx0)%textureSize(data4, 0).x) + 0.5f)/float(textureSize(data4, 0).x), float(float(int(idx0)/textureSize(data4, 0).x) + 0.5f)/float(textureSize(data4, 0).y))).r;
    float val4 = texture(data5, vec2(float(float(int(idx0)%textureSize(data5, 0).x) + 0.5f)/float(textureSize(data5, 0).x), float(float(int(idx0)/textureSize(data5, 0).x) + 0.5f)/float(textureSize(data5, 0).y))).r;
    float alu0 = float((((val0-val1)*val2*sqrt(((1.0)/(val3+(1e-05)))))+val4));
    acc0 = ((alu0*((1.0)/((1.0)+exp2((alu0*((-1.4426950408889634)))))))+acc0);
  }
  out_data = float((acc0*(0.0012755102040816326)));
}`;

const r_10_240 = `#version 300 es
precision highp float;
precision highp int;
in vec2 uv;
uniform int w;
uniform sampler2D data1;
uniform sampler2D data2;
uniform sampler2D data3;
out float out_data;

void main() {
  int idx0 = int(gl_FragCoord.y-0.5f) * w + int(gl_FragCoord.x-0.5f); /* 10 */
  float acc0 = (0.0);
  for (int ridx0 = (0); ridx0 < (240); ++ridx0) {
    float val0 = texture(data1, vec2(float(float(int(ridx0)%textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).x), float(float(int(ridx0)/textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).y))).r;
    float val1 = texture(data2, vec2(float(float(int((idx0*(240))+ridx0)%textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).x), float(float(int((idx0*(240))+ridx0)/textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).y))).r;
    acc0 = ((val0*val1)+acc0);
  }
  float val2 = texture(data3, vec2(float(float(int(idx0)%textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).x), float(float(int(idx0)/textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).y))).r;
  float alu0 = float((acc0+val2));
  out_data = float((alu0*((1.0)/((1.0)+exp2((alu0*((-1.4426950408889634))))))));
}`;

const r_240_10 = `#version 300 es
precision highp float;
precision highp int;
in vec2 uv;
uniform int w;
uniform sampler2D data1;
uniform sampler2D data2;
uniform sampler2D data3;
out float out_data;

void main() {
  int idx0 = int(gl_FragCoord.y-0.5f) * w + int(gl_FragCoord.x-0.5f); /* 240 */
  float acc0 = (0.0);
  for (int ridx0 = (0); ridx0 < (10); ++ridx0) {
    float val0 = texture(data1, vec2(float(float(int(ridx0)%textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).x), float(float(int(ridx0)/textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).y))).r;
    float val1 = texture(data2, vec2(float(float(int((idx0*(10))+ridx0)%textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).x), float(float(int((idx0*(10))+ridx0)/textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).y))).r;
    acc0 = ((val0*val1)+acc0);
  }
  float val2 = texture(data3, vec2(float(float(int(idx0)%textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).x), float(float(int(idx0)/textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).y))).r;
  out_data = float(((1.0)/((1.0)+exp2(((acc0+val2)*((-1.4426950408889634)))))));
}`;

const r_240_28_28_5_5n1 = `#version 300 es
precision highp float;
precision highp int;
in vec2 uv;
uniform int w;
uniform sampler2D data1;
uniform sampler2D data2;
uniform sampler2D data3;
uniform sampler2D data4;
uniform sampler2D data5;
uniform sampler2D data6;
uniform sampler2D data7;
out float out_data;

void main() {
  int idx0 = int(gl_FragCoord.y-0.5f) * w + int(gl_FragCoord.x-0.5f); /* 188160 */
  float acc0 = (0.0);
  for (int ridx0 = (0); ridx0 < (5); ++ridx0) {
    for (int ridx1 = (0); ridx1 < (5); ++ridx1) {
      float val0 = bool((float(((ridx1*((-1)))+((int(idx0)%int((28)))*((-1))))<((-1)))*float((ridx1+(int(idx0)%int((28))))<(30))*float(((ridx0*((-1)))+((int((idx0/(28)))%int((28)))*((-1))))<((-1)))*float((ridx0+(int((idx0/(28)))%int((28))))<(30))))?(texture(data1, vec2(float(float(int(ridx1+(int(idx0)%int((28)))+(ridx0*(28))+((int((idx0/(28)))%int((28)))*(28))+((idx0/(784))*(784))+((-58)))%textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).x), float(float(int(ridx1+(int(idx0)%int((28)))+(ridx0*(28))+((int((idx0/(28)))%int((28)))*(28))+((idx0/(784))*(784))+((-58)))/textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).y))).r):(0.0);
      float val1 = texture(data2, vec2(float(float(int((ridx0*(5))+ridx1+((idx0/(784))*(25)))%textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).x), float(float(int((ridx0*(5))+ridx1+((idx0/(784))*(25)))/textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).y))).r;
      acc0 = ((val0*val1)+acc0);
    }
  }
  float val2 = texture(data3, vec2(float(float(int(idx0/(784))%textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).x), float(float(int(idx0/(784))/textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).y))).r;
  float val3 = texture(data4, vec2(float(float(int(idx0/(784))%textureSize(data4, 0).x) + 0.5f)/float(textureSize(data4, 0).x), float(float(int(idx0/(784))/textureSize(data4, 0).x) + 0.5f)/float(textureSize(data4, 0).y))).r;
  float val4 = texture(data5, vec2(float(float(int(idx0/(784))%textureSize(data5, 0).x) + 0.5f)/float(textureSize(data5, 0).x), float(float(int(idx0/(784))/textureSize(data5, 0).x) + 0.5f)/float(textureSize(data5, 0).y))).r;
  float val5 = texture(data6, vec2(float(float(int(idx0/(784))%textureSize(data6, 0).x) + 0.5f)/float(textureSize(data6, 0).x), float(float(int(idx0/(784))/textureSize(data6, 0).x) + 0.5f)/float(textureSize(data6, 0).y))).r;
  float val6 = texture(data7, vec2(float(float(int(idx0/(784))%textureSize(data7, 0).x) + 0.5f)/float(textureSize(data7, 0).x), float(float(int(idx0/(784))/textureSize(data7, 0).x) + 0.5f)/float(textureSize(data7, 0).y))).r;
  float alu0 = float((((acc0-val2)*val3*sqrt(((1.0)/(val4+(1e-05)))))+val5));
  out_data = float((alu0*((1.0)/((1.0)+exp2((alu0*((-1.4426950408889634))))))*val6));
}`;

const r_40_784_240 = `#version 300 es
precision highp float;
precision highp int;
in vec2 uv;
uniform int w;
uniform sampler2D data1;
uniform sampler2D data2;
uniform sampler2D data3;
uniform sampler2D data4;
uniform sampler2D data5;
uniform sampler2D data6;
uniform sampler2D data7;
out float out_data;

void main() {
  int idx0 = int(gl_FragCoord.y-0.5f) * w + int(gl_FragCoord.x-0.5f); /* 31360 */
  float acc0 = (0.0);
  for (int ridx0 = (0); ridx0 < (240); ++ridx0) {
    float val0 = texture(data1, vec2(float(float(int((ridx0*(784))+(int(idx0)%int((784))))%textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).x), float(float(int((ridx0*(784))+(int(idx0)%int((784))))/textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).y))).r;
    float val1 = texture(data2, vec2(float(float(int(ridx0+((idx0/(784))*(240)))%textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).x), float(float(int(ridx0+((idx0/(784))*(240)))/textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).y))).r;
    acc0 = ((val0*val1)+acc0);
  }
  float val2 = texture(data3, vec2(float(float(int(idx0/(784))%textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).x), float(float(int(idx0/(784))/textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).y))).r;
  float val3 = texture(data4, vec2(float(float(int(idx0/(784))%textureSize(data4, 0).x) + 0.5f)/float(textureSize(data4, 0).x), float(float(int(idx0/(784))/textureSize(data4, 0).x) + 0.5f)/float(textureSize(data4, 0).y))).r;
  float val4 = texture(data5, vec2(float(float(int(idx0/(784))%textureSize(data5, 0).x) + 0.5f)/float(textureSize(data5, 0).x), float(float(int(idx0/(784))/textureSize(data5, 0).x) + 0.5f)/float(textureSize(data5, 0).y))).r;
  float val5 = texture(data6, vec2(float(float(int(idx0/(784))%textureSize(data6, 0).x) + 0.5f)/float(textureSize(data6, 0).x), float(float(int(idx0/(784))/textureSize(data6, 0).x) + 0.5f)/float(textureSize(data6, 0).y))).r;
  float val6 = texture(data7, vec2(float(float(int(idx0)%textureSize(data7, 0).x) + 0.5f)/float(textureSize(data7, 0).x), float(float(int(idx0)/textureSize(data7, 0).x) + 0.5f)/float(textureSize(data7, 0).y))).r;
  out_data = float((((acc0-val2)*val3*sqrt(((1.0)/(val4+(1e-05)))))+val5+val6));
}`;

const r_240_14_14_3_3 = `#version 300 es
precision highp float;
precision highp int;
in vec2 uv;
uniform int w;
uniform sampler2D data1;
uniform sampler2D data2;
out float out_data;

void main() {
  int idx0 = int(gl_FragCoord.y-0.5f) * w + int(gl_FragCoord.x-0.5f); /* 47040 */
  float acc0 = (0.0);
  for (int ridx0 = (0); ridx0 < (3); ++ridx0) {
    for (int ridx1 = (0); ridx1 < (3); ++ridx1) {
      float val0 = bool((float((ridx1+((int(idx0)%int((14)))*(2)))<(28))*float((ridx0+((int((idx0/(14)))%int((14)))*(2)))<(28))))?(texture(data1, vec2(float(float(int(ridx1+((int(idx0)%int((14)))*(2))+(ridx0*(28))+((int((idx0/(14)))%int((14)))*(56))+((idx0/(196))*(784)))%textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).x), float(float(int(ridx1+((int(idx0)%int((14)))*(2))+(ridx0*(28))+((int((idx0/(14)))%int((14)))*(56))+((idx0/(196))*(784)))/textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).y))).r):(0.0);
      float val1 = texture(data2, vec2(float(float(int((ridx0*(3))+ridx1+((idx0/(196))*(9)))%textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).x), float(float(int((ridx0*(3))+ridx1+((idx0/(196))*(9)))/textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).y))).r;
      acc0 = ((val0*val1)+acc0);
    }
  }
  out_data = float(acc0);
}`;

const r_240_196 = `#version 300 es
precision highp float;
precision highp int;
in vec2 uv;
uniform int w;
uniform sampler2D data1;
uniform sampler2D data2;
uniform sampler2D data3;
uniform sampler2D data4;
uniform sampler2D data5;
out float out_data;

void main() {
  int idx0 = int(gl_FragCoord.y-0.5f) * w + int(gl_FragCoord.x-0.5f); /* 240 */
  float acc0 = (0.0);
  for (int ridx0 = (0); ridx0 < (196); ++ridx0) {
    float val0 = texture(data1, vec2(float(float(int((idx0*(196))+ridx0)%textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).x), float(float(int((idx0*(196))+ridx0)/textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).y))).r;
    float val1 = texture(data2, vec2(float(float(int(idx0)%textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).x), float(float(int(idx0)/textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).y))).r;
    float val2 = texture(data3, vec2(float(float(int(idx0)%textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).x), float(float(int(idx0)/textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).y))).r;
    float val3 = texture(data4, vec2(float(float(int(idx0)%textureSize(data4, 0).x) + 0.5f)/float(textureSize(data4, 0).x), float(float(int(idx0)/textureSize(data4, 0).x) + 0.5f)/float(textureSize(data4, 0).y))).r;
    float val4 = texture(data5, vec2(float(float(int(idx0)%textureSize(data5, 0).x) + 0.5f)/float(textureSize(data5, 0).x), float(float(int(idx0)/textureSize(data5, 0).x) + 0.5f)/float(textureSize(data5, 0).y))).r;
    float alu0 = float((((val0-val1)*val2*sqrt(((1.0)/(val3+(1e-05)))))+val4));
    acc0 = ((alu0*((1.0)/((1.0)+exp2((alu0*((-1.4426950408889634)))))))+acc0);
  }
  out_data = float((acc0*(0.00510204081632653)));
}`;

const r_240_14_14_3_3n1 = `#version 300 es
precision highp float;
precision highp int;
in vec2 uv;
uniform int w;
uniform sampler2D data1;
uniform sampler2D data2;
uniform sampler2D data3;
uniform sampler2D data4;
uniform sampler2D data5;
uniform sampler2D data6;
uniform sampler2D data7;
out float out_data;

void main() {
  int idx0 = int(gl_FragCoord.y-0.5f) * w + int(gl_FragCoord.x-0.5f); /* 47040 */
  float acc0 = (0.0);
  for (int ridx0 = (0); ridx0 < (3); ++ridx0) {
    for (int ridx1 = (0); ridx1 < (3); ++ridx1) {
      float val0 = bool((float((ridx1+((int(idx0)%int((14)))*(2)))<(28))*float((ridx0+((int((idx0/(14)))%int((14)))*(2)))<(28))))?(texture(data1, vec2(float(float(int(ridx1+((int(idx0)%int((14)))*(2))+(ridx0*(28))+((int((idx0/(14)))%int((14)))*(56))+((idx0/(196))*(784)))%textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).x), float(float(int(ridx1+((int(idx0)%int((14)))*(2))+(ridx0*(28))+((int((idx0/(14)))%int((14)))*(56))+((idx0/(196))*(784)))/textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).y))).r):(0.0);
      float val1 = texture(data2, vec2(float(float(int((ridx0*(3))+ridx1+((idx0/(196))*(9)))%textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).x), float(float(int((ridx0*(3))+ridx1+((idx0/(196))*(9)))/textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).y))).r;
      acc0 = ((val0*val1)+acc0);
    }
  }
  float val2 = texture(data3, vec2(float(float(int(idx0/(196))%textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).x), float(float(int(idx0/(196))/textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).y))).r;
  float val3 = texture(data4, vec2(float(float(int(idx0/(196))%textureSize(data4, 0).x) + 0.5f)/float(textureSize(data4, 0).x), float(float(int(idx0/(196))/textureSize(data4, 0).x) + 0.5f)/float(textureSize(data4, 0).y))).r;
  float val4 = texture(data5, vec2(float(float(int(idx0/(196))%textureSize(data5, 0).x) + 0.5f)/float(textureSize(data5, 0).x), float(float(int(idx0/(196))/textureSize(data5, 0).x) + 0.5f)/float(textureSize(data5, 0).y))).r;
  float val5 = texture(data6, vec2(float(float(int(idx0/(196))%textureSize(data6, 0).x) + 0.5f)/float(textureSize(data6, 0).x), float(float(int(idx0/(196))/textureSize(data6, 0).x) + 0.5f)/float(textureSize(data6, 0).y))).r;
  float val6 = texture(data7, vec2(float(float(int(idx0/(196))%textureSize(data7, 0).x) + 0.5f)/float(textureSize(data7, 0).x), float(float(int(idx0/(196))/textureSize(data7, 0).x) + 0.5f)/float(textureSize(data7, 0).y))).r;
  float alu0 = float((((acc0-val2)*val3*sqrt(((1.0)/(val4+(1e-05)))))+val5));
  out_data = float((alu0*((1.0)/((1.0)+exp2((alu0*((-1.4426950408889634))))))*val6));
}`;

const r_80_196_240 = `#version 300 es
precision highp float;
precision highp int;
in vec2 uv;
uniform int w;
uniform sampler2D data1;
uniform sampler2D data2;
uniform sampler2D data3;
uniform sampler2D data4;
uniform sampler2D data5;
uniform sampler2D data6;
out float out_data;

void main() {
  int idx0 = int(gl_FragCoord.y-0.5f) * w + int(gl_FragCoord.x-0.5f); /* 15680 */
  float acc0 = (0.0);
  for (int ridx0 = (0); ridx0 < (240); ++ridx0) {
    float val0 = texture(data1, vec2(float(float(int((ridx0*(196))+(int(idx0)%int((196))))%textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).x), float(float(int((ridx0*(196))+(int(idx0)%int((196))))/textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).y))).r;
    float val1 = texture(data2, vec2(float(float(int(ridx0+((idx0/(196))*(240)))%textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).x), float(float(int(ridx0+((idx0/(196))*(240)))/textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).y))).r;
    acc0 = ((val0*val1)+acc0);
  }
  float val2 = texture(data3, vec2(float(float(int(idx0/(196))%textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).x), float(float(int(idx0/(196))/textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).y))).r;
  float val3 = texture(data4, vec2(float(float(int(idx0/(196))%textureSize(data4, 0).x) + 0.5f)/float(textureSize(data4, 0).x), float(float(int(idx0/(196))/textureSize(data4, 0).x) + 0.5f)/float(textureSize(data4, 0).y))).r;
  float val4 = texture(data5, vec2(float(float(int(idx0/(196))%textureSize(data5, 0).x) + 0.5f)/float(textureSize(data5, 0).x), float(float(int(idx0/(196))/textureSize(data5, 0).x) + 0.5f)/float(textureSize(data5, 0).y))).r;
  float val5 = texture(data6, vec2(float(float(int(idx0/(196))%textureSize(data6, 0).x) + 0.5f)/float(textureSize(data6, 0).x), float(float(int(idx0/(196))/textureSize(data6, 0).x) + 0.5f)/float(textureSize(data6, 0).y))).r;
  out_data = float((((acc0-val2)*val3*sqrt(((1.0)/(val4+(1e-05)))))+val5));
}`;

const r_480_196_80 = `#version 300 es
precision highp float;
precision highp int;
in vec2 uv;
uniform int w;
uniform sampler2D data1;
uniform sampler2D data2;
uniform sampler2D data3;
uniform sampler2D data4;
uniform sampler2D data5;
uniform sampler2D data6;
out float out_data;

void main() {
  int idx0 = int(gl_FragCoord.y-0.5f) * w + int(gl_FragCoord.x-0.5f); /* 94080 */
  float acc0 = (0.0);
  for (int ridx0 = (0); ridx0 < (80); ++ridx0) {
    float val0 = texture(data1, vec2(float(float(int((ridx0*(196))+(int(idx0)%int((196))))%textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).x), float(float(int((ridx0*(196))+(int(idx0)%int((196))))/textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).y))).r;
    float val1 = texture(data2, vec2(float(float(int(ridx0+((idx0/(196))*(80)))%textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).x), float(float(int(ridx0+((idx0/(196))*(80)))/textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).y))).r;
    acc0 = ((val0*val1)+acc0);
  }
  float val2 = texture(data3, vec2(float(float(int(idx0/(196))%textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).x), float(float(int(idx0/(196))/textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).y))).r;
  float val3 = texture(data4, vec2(float(float(int(idx0/(196))%textureSize(data4, 0).x) + 0.5f)/float(textureSize(data4, 0).x), float(float(int(idx0/(196))/textureSize(data4, 0).x) + 0.5f)/float(textureSize(data4, 0).y))).r;
  float val4 = texture(data5, vec2(float(float(int(idx0/(196))%textureSize(data5, 0).x) + 0.5f)/float(textureSize(data5, 0).x), float(float(int(idx0/(196))/textureSize(data5, 0).x) + 0.5f)/float(textureSize(data5, 0).y))).r;
  float val5 = texture(data6, vec2(float(float(int(idx0/(196))%textureSize(data6, 0).x) + 0.5f)/float(textureSize(data6, 0).x), float(float(int(idx0/(196))/textureSize(data6, 0).x) + 0.5f)/float(textureSize(data6, 0).y))).r;
  float alu0 = float((((acc0-val2)*val3*sqrt(((1.0)/(val4+(1e-05)))))+val5));
  out_data = float((alu0*((1.0)/((1.0)+exp2((alu0*((-1.4426950408889634))))))));
}`;

const r_480_14_14_3_3 = `#version 300 es
precision highp float;
precision highp int;
in vec2 uv;
uniform int w;
uniform sampler2D data1;
uniform sampler2D data2;
out float out_data;

void main() {
  int idx0 = int(gl_FragCoord.y-0.5f) * w + int(gl_FragCoord.x-0.5f); /* 94080 */
  float acc0 = (0.0);
  for (int ridx0 = (0); ridx0 < (3); ++ridx0) {
    for (int ridx1 = (0); ridx1 < (3); ++ridx1) {
      float val0 = bool((float(((ridx1*((-1)))+((int(idx0)%int((14)))*((-1))))<(0))*float((ridx1+(int(idx0)%int((14))))<(15))*float(((ridx0*((-1)))+((int((idx0/(14)))%int((14)))*((-1))))<(0))*float((ridx0+(int((idx0/(14)))%int((14))))<(15))))?(texture(data1, vec2(float(float(int(ridx1+(int(idx0)%int((14)))+(ridx0*(14))+((int((idx0/(14)))%int((14)))*(14))+((idx0/(196))*(196))+((-15)))%textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).x), float(float(int(ridx1+(int(idx0)%int((14)))+(ridx0*(14))+((int((idx0/(14)))%int((14)))*(14))+((idx0/(196))*(196))+((-15)))/textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).y))).r):(0.0);
      float val1 = texture(data2, vec2(float(float(int((ridx0*(3))+ridx1+((idx0/(196))*(9)))%textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).x), float(float(int((ridx0*(3))+ridx1+((idx0/(196))*(9)))/textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).y))).r;
      acc0 = ((val0*val1)+acc0);
    }
  }
  out_data = float(acc0);
}`;

const r_480_196 = `#version 300 es
precision highp float;
precision highp int;
in vec2 uv;
uniform int w;
uniform sampler2D data1;
uniform sampler2D data2;
uniform sampler2D data3;
uniform sampler2D data4;
uniform sampler2D data5;
out float out_data;

void main() {
  int idx0 = int(gl_FragCoord.y-0.5f) * w + int(gl_FragCoord.x-0.5f); /* 480 */
  float acc0 = (0.0);
  for (int ridx0 = (0); ridx0 < (196); ++ridx0) {
    float val0 = texture(data1, vec2(float(float(int((idx0*(196))+ridx0)%textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).x), float(float(int((idx0*(196))+ridx0)/textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).y))).r;
    float val1 = texture(data2, vec2(float(float(int(idx0)%textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).x), float(float(int(idx0)/textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).y))).r;
    float val2 = texture(data3, vec2(float(float(int(idx0)%textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).x), float(float(int(idx0)/textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).y))).r;
    float val3 = texture(data4, vec2(float(float(int(idx0)%textureSize(data4, 0).x) + 0.5f)/float(textureSize(data4, 0).x), float(float(int(idx0)/textureSize(data4, 0).x) + 0.5f)/float(textureSize(data4, 0).y))).r;
    float val4 = texture(data5, vec2(float(float(int(idx0)%textureSize(data5, 0).x) + 0.5f)/float(textureSize(data5, 0).x), float(float(int(idx0)/textureSize(data5, 0).x) + 0.5f)/float(textureSize(data5, 0).y))).r;
    float alu0 = float((((val0-val1)*val2*sqrt(((1.0)/(val3+(1e-05)))))+val4));
    acc0 = ((alu0*((1.0)/((1.0)+exp2((alu0*((-1.4426950408889634)))))))+acc0);
  }
  out_data = float((acc0*(0.00510204081632653)));
}`;

const r_20_480 = `#version 300 es
precision highp float;
precision highp int;
in vec2 uv;
uniform int w;
uniform sampler2D data1;
uniform sampler2D data2;
uniform sampler2D data3;
out float out_data;

void main() {
  int idx0 = int(gl_FragCoord.y-0.5f) * w + int(gl_FragCoord.x-0.5f); /* 20 */
  float acc0 = (0.0);
  for (int ridx0 = (0); ridx0 < (480); ++ridx0) {
    float val0 = texture(data1, vec2(float(float(int(ridx0)%textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).x), float(float(int(ridx0)/textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).y))).r;
    float val1 = texture(data2, vec2(float(float(int((idx0*(480))+ridx0)%textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).x), float(float(int((idx0*(480))+ridx0)/textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).y))).r;
    acc0 = ((val0*val1)+acc0);
  }
  float val2 = texture(data3, vec2(float(float(int(idx0)%textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).x), float(float(int(idx0)/textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).y))).r;
  float alu0 = float((acc0+val2));
  out_data = float((alu0*((1.0)/((1.0)+exp2((alu0*((-1.4426950408889634))))))));
}`;

const r_480_20 = `#version 300 es
precision highp float;
precision highp int;
in vec2 uv;
uniform int w;
uniform sampler2D data1;
uniform sampler2D data2;
uniform sampler2D data3;
out float out_data;

void main() {
  int idx0 = int(gl_FragCoord.y-0.5f) * w + int(gl_FragCoord.x-0.5f); /* 480 */
  float acc0 = (0.0);
  for (int ridx0 = (0); ridx0 < (20); ++ridx0) {
    float val0 = texture(data1, vec2(float(float(int(ridx0)%textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).x), float(float(int(ridx0)/textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).y))).r;
    float val1 = texture(data2, vec2(float(float(int((idx0*(20))+ridx0)%textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).x), float(float(int((idx0*(20))+ridx0)/textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).y))).r;
    acc0 = ((val0*val1)+acc0);
  }
  float val2 = texture(data3, vec2(float(float(int(idx0)%textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).x), float(float(int(idx0)/textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).y))).r;
  out_data = float(((1.0)/((1.0)+exp2(((acc0+val2)*((-1.4426950408889634)))))));
}`;

const r_480_14_14_3_3n1 = `#version 300 es
precision highp float;
precision highp int;
in vec2 uv;
uniform int w;
uniform sampler2D data1;
uniform sampler2D data2;
uniform sampler2D data3;
uniform sampler2D data4;
uniform sampler2D data5;
uniform sampler2D data6;
uniform sampler2D data7;
out float out_data;

void main() {
  int idx0 = int(gl_FragCoord.y-0.5f) * w + int(gl_FragCoord.x-0.5f); /* 94080 */
  float acc0 = (0.0);
  for (int ridx0 = (0); ridx0 < (3); ++ridx0) {
    for (int ridx1 = (0); ridx1 < (3); ++ridx1) {
      float val0 = bool((float(((ridx1*((-1)))+((int(idx0)%int((14)))*((-1))))<(0))*float((ridx1+(int(idx0)%int((14))))<(15))*float(((ridx0*((-1)))+((int((idx0/(14)))%int((14)))*((-1))))<(0))*float((ridx0+(int((idx0/(14)))%int((14))))<(15))))?(texture(data1, vec2(float(float(int(ridx1+(int(idx0)%int((14)))+(ridx0*(14))+((int((idx0/(14)))%int((14)))*(14))+((idx0/(196))*(196))+((-15)))%textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).x), float(float(int(ridx1+(int(idx0)%int((14)))+(ridx0*(14))+((int((idx0/(14)))%int((14)))*(14))+((idx0/(196))*(196))+((-15)))/textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).y))).r):(0.0);
      float val1 = texture(data2, vec2(float(float(int((ridx0*(3))+ridx1+((idx0/(196))*(9)))%textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).x), float(float(int((ridx0*(3))+ridx1+((idx0/(196))*(9)))/textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).y))).r;
      acc0 = ((val0*val1)+acc0);
    }
  }
  float val2 = texture(data3, vec2(float(float(int(idx0/(196))%textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).x), float(float(int(idx0/(196))/textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).y))).r;
  float val3 = texture(data4, vec2(float(float(int(idx0/(196))%textureSize(data4, 0).x) + 0.5f)/float(textureSize(data4, 0).x), float(float(int(idx0/(196))/textureSize(data4, 0).x) + 0.5f)/float(textureSize(data4, 0).y))).r;
  float val4 = texture(data5, vec2(float(float(int(idx0/(196))%textureSize(data5, 0).x) + 0.5f)/float(textureSize(data5, 0).x), float(float(int(idx0/(196))/textureSize(data5, 0).x) + 0.5f)/float(textureSize(data5, 0).y))).r;
  float val5 = texture(data6, vec2(float(float(int(idx0/(196))%textureSize(data6, 0).x) + 0.5f)/float(textureSize(data6, 0).x), float(float(int(idx0/(196))/textureSize(data6, 0).x) + 0.5f)/float(textureSize(data6, 0).y))).r;
  float val6 = texture(data7, vec2(float(float(int(idx0/(196))%textureSize(data7, 0).x) + 0.5f)/float(textureSize(data7, 0).x), float(float(int(idx0/(196))/textureSize(data7, 0).x) + 0.5f)/float(textureSize(data7, 0).y))).r;
  float alu0 = float((((acc0-val2)*val3*sqrt(((1.0)/(val4+(1e-05)))))+val5));
  out_data = float((alu0*((1.0)/((1.0)+exp2((alu0*((-1.4426950408889634))))))*val6));
}`;

const r_80_196_480 = `#version 300 es
precision highp float;
precision highp int;
in vec2 uv;
uniform int w;
uniform sampler2D data1;
uniform sampler2D data2;
uniform sampler2D data3;
uniform sampler2D data4;
uniform sampler2D data5;
uniform sampler2D data6;
uniform sampler2D data7;
out float out_data;

void main() {
  int idx0 = int(gl_FragCoord.y-0.5f) * w + int(gl_FragCoord.x-0.5f); /* 15680 */
  float acc0 = (0.0);
  for (int ridx0 = (0); ridx0 < (480); ++ridx0) {
    float val0 = texture(data1, vec2(float(float(int((ridx0*(196))+(int(idx0)%int((196))))%textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).x), float(float(int((ridx0*(196))+(int(idx0)%int((196))))/textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).y))).r;
    float val1 = texture(data2, vec2(float(float(int(ridx0+((idx0/(196))*(480)))%textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).x), float(float(int(ridx0+((idx0/(196))*(480)))/textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).y))).r;
    acc0 = ((val0*val1)+acc0);
  }
  float val2 = texture(data3, vec2(float(float(int(idx0/(196))%textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).x), float(float(int(idx0/(196))/textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).y))).r;
  float val3 = texture(data4, vec2(float(float(int(idx0/(196))%textureSize(data4, 0).x) + 0.5f)/float(textureSize(data4, 0).x), float(float(int(idx0/(196))/textureSize(data4, 0).x) + 0.5f)/float(textureSize(data4, 0).y))).r;
  float val4 = texture(data5, vec2(float(float(int(idx0/(196))%textureSize(data5, 0).x) + 0.5f)/float(textureSize(data5, 0).x), float(float(int(idx0/(196))/textureSize(data5, 0).x) + 0.5f)/float(textureSize(data5, 0).y))).r;
  float val5 = texture(data6, vec2(float(float(int(idx0/(196))%textureSize(data6, 0).x) + 0.5f)/float(textureSize(data6, 0).x), float(float(int(idx0/(196))/textureSize(data6, 0).x) + 0.5f)/float(textureSize(data6, 0).y))).r;
  float val6 = texture(data7, vec2(float(float(int(idx0)%textureSize(data7, 0).x) + 0.5f)/float(textureSize(data7, 0).x), float(float(int(idx0)/textureSize(data7, 0).x) + 0.5f)/float(textureSize(data7, 0).y))).r;
  out_data = float((((acc0-val2)*val3*sqrt(((1.0)/(val4+(1e-05)))))+val5+val6));
}`;

const r_480_14_14_5_5 = `#version 300 es
precision highp float;
precision highp int;
in vec2 uv;
uniform int w;
uniform sampler2D data1;
uniform sampler2D data2;
out float out_data;

void main() {
  int idx0 = int(gl_FragCoord.y-0.5f) * w + int(gl_FragCoord.x-0.5f); /* 94080 */
  float acc0 = (0.0);
  for (int ridx0 = (0); ridx0 < (5); ++ridx0) {
    for (int ridx1 = (0); ridx1 < (5); ++ridx1) {
      float val0 = bool((float(((ridx1*((-1)))+((int(idx0)%int((14)))*((-1))))<((-1)))*float((ridx1+(int(idx0)%int((14))))<(16))*float(((ridx0*((-1)))+((int((idx0/(14)))%int((14)))*((-1))))<((-1)))*float((ridx0+(int((idx0/(14)))%int((14))))<(16))))?(texture(data1, vec2(float(float(int(ridx1+(int(idx0)%int((14)))+(ridx0*(14))+((int((idx0/(14)))%int((14)))*(14))+((idx0/(196))*(196))+((-30)))%textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).x), float(float(int(ridx1+(int(idx0)%int((14)))+(ridx0*(14))+((int((idx0/(14)))%int((14)))*(14))+((idx0/(196))*(196))+((-30)))/textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).y))).r):(0.0);
      float val1 = texture(data2, vec2(float(float(int((ridx0*(5))+ridx1+((idx0/(196))*(25)))%textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).x), float(float(int((ridx0*(5))+ridx1+((idx0/(196))*(25)))/textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).y))).r;
      acc0 = ((val0*val1)+acc0);
    }
  }
  out_data = float(acc0);
}`;

const r_480_14_14_5_5n1 = `#version 300 es
precision highp float;
precision highp int;
in vec2 uv;
uniform int w;
uniform sampler2D data1;
uniform sampler2D data2;
uniform sampler2D data3;
uniform sampler2D data4;
uniform sampler2D data5;
uniform sampler2D data6;
uniform sampler2D data7;
out float out_data;

void main() {
  int idx0 = int(gl_FragCoord.y-0.5f) * w + int(gl_FragCoord.x-0.5f); /* 94080 */
  float acc0 = (0.0);
  for (int ridx0 = (0); ridx0 < (5); ++ridx0) {
    for (int ridx1 = (0); ridx1 < (5); ++ridx1) {
      float val0 = bool((float(((ridx1*((-1)))+((int(idx0)%int((14)))*((-1))))<((-1)))*float((ridx1+(int(idx0)%int((14))))<(16))*float(((ridx0*((-1)))+((int((idx0/(14)))%int((14)))*((-1))))<((-1)))*float((ridx0+(int((idx0/(14)))%int((14))))<(16))))?(texture(data1, vec2(float(float(int(ridx1+(int(idx0)%int((14)))+(ridx0*(14))+((int((idx0/(14)))%int((14)))*(14))+((idx0/(196))*(196))+((-30)))%textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).x), float(float(int(ridx1+(int(idx0)%int((14)))+(ridx0*(14))+((int((idx0/(14)))%int((14)))*(14))+((idx0/(196))*(196))+((-30)))/textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).y))).r):(0.0);
      float val1 = texture(data2, vec2(float(float(int((ridx0*(5))+ridx1+((idx0/(196))*(25)))%textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).x), float(float(int((ridx0*(5))+ridx1+((idx0/(196))*(25)))/textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).y))).r;
      acc0 = ((val0*val1)+acc0);
    }
  }
  float val2 = texture(data3, vec2(float(float(int(idx0/(196))%textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).x), float(float(int(idx0/(196))/textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).y))).r;
  float val3 = texture(data4, vec2(float(float(int(idx0/(196))%textureSize(data4, 0).x) + 0.5f)/float(textureSize(data4, 0).x), float(float(int(idx0/(196))/textureSize(data4, 0).x) + 0.5f)/float(textureSize(data4, 0).y))).r;
  float val4 = texture(data5, vec2(float(float(int(idx0/(196))%textureSize(data5, 0).x) + 0.5f)/float(textureSize(data5, 0).x), float(float(int(idx0/(196))/textureSize(data5, 0).x) + 0.5f)/float(textureSize(data5, 0).y))).r;
  float val5 = texture(data6, vec2(float(float(int(idx0/(196))%textureSize(data6, 0).x) + 0.5f)/float(textureSize(data6, 0).x), float(float(int(idx0/(196))/textureSize(data6, 0).x) + 0.5f)/float(textureSize(data6, 0).y))).r;
  float val6 = texture(data7, vec2(float(float(int(idx0/(196))%textureSize(data7, 0).x) + 0.5f)/float(textureSize(data7, 0).x), float(float(int(idx0/(196))/textureSize(data7, 0).x) + 0.5f)/float(textureSize(data7, 0).y))).r;
  float alu0 = float((((acc0-val2)*val3*sqrt(((1.0)/(val4+(1e-05)))))+val5));
  out_data = float((alu0*((1.0)/((1.0)+exp2((alu0*((-1.4426950408889634))))))*val6));
}`;

const r_112_196_480 = `#version 300 es
precision highp float;
precision highp int;
in vec2 uv;
uniform int w;
uniform sampler2D data1;
uniform sampler2D data2;
uniform sampler2D data3;
uniform sampler2D data4;
uniform sampler2D data5;
uniform sampler2D data6;
out float out_data;

void main() {
  int idx0 = int(gl_FragCoord.y-0.5f) * w + int(gl_FragCoord.x-0.5f); /* 21952 */
  float acc0 = (0.0);
  for (int ridx0 = (0); ridx0 < (480); ++ridx0) {
    float val0 = texture(data1, vec2(float(float(int((ridx0*(196))+(int(idx0)%int((196))))%textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).x), float(float(int((ridx0*(196))+(int(idx0)%int((196))))/textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).y))).r;
    float val1 = texture(data2, vec2(float(float(int(ridx0+((idx0/(196))*(480)))%textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).x), float(float(int(ridx0+((idx0/(196))*(480)))/textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).y))).r;
    acc0 = ((val0*val1)+acc0);
  }
  float val2 = texture(data3, vec2(float(float(int(idx0/(196))%textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).x), float(float(int(idx0/(196))/textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).y))).r;
  float val3 = texture(data4, vec2(float(float(int(idx0/(196))%textureSize(data4, 0).x) + 0.5f)/float(textureSize(data4, 0).x), float(float(int(idx0/(196))/textureSize(data4, 0).x) + 0.5f)/float(textureSize(data4, 0).y))).r;
  float val4 = texture(data5, vec2(float(float(int(idx0/(196))%textureSize(data5, 0).x) + 0.5f)/float(textureSize(data5, 0).x), float(float(int(idx0/(196))/textureSize(data5, 0).x) + 0.5f)/float(textureSize(data5, 0).y))).r;
  float val5 = texture(data6, vec2(float(float(int(idx0/(196))%textureSize(data6, 0).x) + 0.5f)/float(textureSize(data6, 0).x), float(float(int(idx0/(196))/textureSize(data6, 0).x) + 0.5f)/float(textureSize(data6, 0).y))).r;
  out_data = float((((acc0-val2)*val3*sqrt(((1.0)/(val4+(1e-05)))))+val5));
}`;

const r_672_196_112 = `#version 300 es
precision highp float;
precision highp int;
in vec2 uv;
uniform int w;
uniform sampler2D data1;
uniform sampler2D data2;
uniform sampler2D data3;
uniform sampler2D data4;
uniform sampler2D data5;
uniform sampler2D data6;
out float out_data;

void main() {
  int idx0 = int(gl_FragCoord.y-0.5f) * w + int(gl_FragCoord.x-0.5f); /* 131712 */
  float acc0 = (0.0);
  for (int ridx0 = (0); ridx0 < (112); ++ridx0) {
    float val0 = texture(data1, vec2(float(float(int((ridx0*(196))+(int(idx0)%int((196))))%textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).x), float(float(int((ridx0*(196))+(int(idx0)%int((196))))/textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).y))).r;
    float val1 = texture(data2, vec2(float(float(int(ridx0+((idx0/(196))*(112)))%textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).x), float(float(int(ridx0+((idx0/(196))*(112)))/textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).y))).r;
    acc0 = ((val0*val1)+acc0);
  }
  float val2 = texture(data3, vec2(float(float(int(idx0/(196))%textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).x), float(float(int(idx0/(196))/textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).y))).r;
  float val3 = texture(data4, vec2(float(float(int(idx0/(196))%textureSize(data4, 0).x) + 0.5f)/float(textureSize(data4, 0).x), float(float(int(idx0/(196))/textureSize(data4, 0).x) + 0.5f)/float(textureSize(data4, 0).y))).r;
  float val4 = texture(data5, vec2(float(float(int(idx0/(196))%textureSize(data5, 0).x) + 0.5f)/float(textureSize(data5, 0).x), float(float(int(idx0/(196))/textureSize(data5, 0).x) + 0.5f)/float(textureSize(data5, 0).y))).r;
  float val5 = texture(data6, vec2(float(float(int(idx0/(196))%textureSize(data6, 0).x) + 0.5f)/float(textureSize(data6, 0).x), float(float(int(idx0/(196))/textureSize(data6, 0).x) + 0.5f)/float(textureSize(data6, 0).y))).r;
  float alu0 = float((((acc0-val2)*val3*sqrt(((1.0)/(val4+(1e-05)))))+val5));
  out_data = float((alu0*((1.0)/((1.0)+exp2((alu0*((-1.4426950408889634))))))));
}`;

const r_672_14_14_5_5 = `#version 300 es
precision highp float;
precision highp int;
in vec2 uv;
uniform int w;
uniform sampler2D data1;
uniform sampler2D data2;
out float out_data;

void main() {
  int idx0 = int(gl_FragCoord.y-0.5f) * w + int(gl_FragCoord.x-0.5f); /* 131712 */
  float acc0 = (0.0);
  for (int ridx0 = (0); ridx0 < (5); ++ridx0) {
    for (int ridx1 = (0); ridx1 < (5); ++ridx1) {
      float val0 = bool((float(((ridx1*((-1)))+((int(idx0)%int((14)))*((-1))))<((-1)))*float((ridx1+(int(idx0)%int((14))))<(16))*float(((ridx0*((-1)))+((int((idx0/(14)))%int((14)))*((-1))))<((-1)))*float((ridx0+(int((idx0/(14)))%int((14))))<(16))))?(texture(data1, vec2(float(float(int(ridx1+(int(idx0)%int((14)))+(ridx0*(14))+((int((idx0/(14)))%int((14)))*(14))+((idx0/(196))*(196))+((-30)))%textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).x), float(float(int(ridx1+(int(idx0)%int((14)))+(ridx0*(14))+((int((idx0/(14)))%int((14)))*(14))+((idx0/(196))*(196))+((-30)))/textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).y))).r):(0.0);
      float val1 = texture(data2, vec2(float(float(int((ridx0*(5))+ridx1+((idx0/(196))*(25)))%textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).x), float(float(int((ridx0*(5))+ridx1+((idx0/(196))*(25)))/textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).y))).r;
      acc0 = ((val0*val1)+acc0);
    }
  }
  out_data = float(acc0);
}`;

const r_672_196 = `#version 300 es
precision highp float;
precision highp int;
in vec2 uv;
uniform int w;
uniform sampler2D data1;
uniform sampler2D data2;
uniform sampler2D data3;
uniform sampler2D data4;
uniform sampler2D data5;
out float out_data;

void main() {
  int idx0 = int(gl_FragCoord.y-0.5f) * w + int(gl_FragCoord.x-0.5f); /* 672 */
  float acc0 = (0.0);
  for (int ridx0 = (0); ridx0 < (196); ++ridx0) {
    float val0 = texture(data1, vec2(float(float(int((idx0*(196))+ridx0)%textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).x), float(float(int((idx0*(196))+ridx0)/textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).y))).r;
    float val1 = texture(data2, vec2(float(float(int(idx0)%textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).x), float(float(int(idx0)/textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).y))).r;
    float val2 = texture(data3, vec2(float(float(int(idx0)%textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).x), float(float(int(idx0)/textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).y))).r;
    float val3 = texture(data4, vec2(float(float(int(idx0)%textureSize(data4, 0).x) + 0.5f)/float(textureSize(data4, 0).x), float(float(int(idx0)/textureSize(data4, 0).x) + 0.5f)/float(textureSize(data4, 0).y))).r;
    float val4 = texture(data5, vec2(float(float(int(idx0)%textureSize(data5, 0).x) + 0.5f)/float(textureSize(data5, 0).x), float(float(int(idx0)/textureSize(data5, 0).x) + 0.5f)/float(textureSize(data5, 0).y))).r;
    float alu0 = float((((val0-val1)*val2*sqrt(((1.0)/(val3+(1e-05)))))+val4));
    acc0 = ((alu0*((1.0)/((1.0)+exp2((alu0*((-1.4426950408889634)))))))+acc0);
  }
  out_data = float((acc0*(0.00510204081632653)));
}`;

const r_28_672 = `#version 300 es
precision highp float;
precision highp int;
in vec2 uv;
uniform int w;
uniform sampler2D data1;
uniform sampler2D data2;
uniform sampler2D data3;
out float out_data;

void main() {
  int idx0 = int(gl_FragCoord.y-0.5f) * w + int(gl_FragCoord.x-0.5f); /* 28 */
  float acc0 = (0.0);
  for (int ridx0 = (0); ridx0 < (672); ++ridx0) {
    float val0 = texture(data1, vec2(float(float(int(ridx0)%textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).x), float(float(int(ridx0)/textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).y))).r;
    float val1 = texture(data2, vec2(float(float(int((idx0*(672))+ridx0)%textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).x), float(float(int((idx0*(672))+ridx0)/textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).y))).r;
    acc0 = ((val0*val1)+acc0);
  }
  float val2 = texture(data3, vec2(float(float(int(idx0)%textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).x), float(float(int(idx0)/textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).y))).r;
  float alu0 = float((acc0+val2));
  out_data = float((alu0*((1.0)/((1.0)+exp2((alu0*((-1.4426950408889634))))))));
}`;

const r_672_28 = `#version 300 es
precision highp float;
precision highp int;
in vec2 uv;
uniform int w;
uniform sampler2D data1;
uniform sampler2D data2;
uniform sampler2D data3;
out float out_data;

void main() {
  int idx0 = int(gl_FragCoord.y-0.5f) * w + int(gl_FragCoord.x-0.5f); /* 672 */
  float acc0 = (0.0);
  for (int ridx0 = (0); ridx0 < (28); ++ridx0) {
    float val0 = texture(data1, vec2(float(float(int(ridx0)%textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).x), float(float(int(ridx0)/textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).y))).r;
    float val1 = texture(data2, vec2(float(float(int((idx0*(28))+ridx0)%textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).x), float(float(int((idx0*(28))+ridx0)/textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).y))).r;
    acc0 = ((val0*val1)+acc0);
  }
  float val2 = texture(data3, vec2(float(float(int(idx0)%textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).x), float(float(int(idx0)/textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).y))).r;
  out_data = float(((1.0)/((1.0)+exp2(((acc0+val2)*((-1.4426950408889634)))))));
}`;

const r_672_14_14_5_5n1 = `#version 300 es
precision highp float;
precision highp int;
in vec2 uv;
uniform int w;
uniform sampler2D data1;
uniform sampler2D data2;
uniform sampler2D data3;
uniform sampler2D data4;
uniform sampler2D data5;
uniform sampler2D data6;
uniform sampler2D data7;
out float out_data;

void main() {
  int idx0 = int(gl_FragCoord.y-0.5f) * w + int(gl_FragCoord.x-0.5f); /* 131712 */
  float acc0 = (0.0);
  for (int ridx0 = (0); ridx0 < (5); ++ridx0) {
    for (int ridx1 = (0); ridx1 < (5); ++ridx1) {
      float val0 = bool((float(((ridx1*((-1)))+((int(idx0)%int((14)))*((-1))))<((-1)))*float((ridx1+(int(idx0)%int((14))))<(16))*float(((ridx0*((-1)))+((int((idx0/(14)))%int((14)))*((-1))))<((-1)))*float((ridx0+(int((idx0/(14)))%int((14))))<(16))))?(texture(data1, vec2(float(float(int(ridx1+(int(idx0)%int((14)))+(ridx0*(14))+((int((idx0/(14)))%int((14)))*(14))+((idx0/(196))*(196))+((-30)))%textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).x), float(float(int(ridx1+(int(idx0)%int((14)))+(ridx0*(14))+((int((idx0/(14)))%int((14)))*(14))+((idx0/(196))*(196))+((-30)))/textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).y))).r):(0.0);
      float val1 = texture(data2, vec2(float(float(int((ridx0*(5))+ridx1+((idx0/(196))*(25)))%textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).x), float(float(int((ridx0*(5))+ridx1+((idx0/(196))*(25)))/textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).y))).r;
      acc0 = ((val0*val1)+acc0);
    }
  }
  float val2 = texture(data3, vec2(float(float(int(idx0/(196))%textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).x), float(float(int(idx0/(196))/textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).y))).r;
  float val3 = texture(data4, vec2(float(float(int(idx0/(196))%textureSize(data4, 0).x) + 0.5f)/float(textureSize(data4, 0).x), float(float(int(idx0/(196))/textureSize(data4, 0).x) + 0.5f)/float(textureSize(data4, 0).y))).r;
  float val4 = texture(data5, vec2(float(float(int(idx0/(196))%textureSize(data5, 0).x) + 0.5f)/float(textureSize(data5, 0).x), float(float(int(idx0/(196))/textureSize(data5, 0).x) + 0.5f)/float(textureSize(data5, 0).y))).r;
  float val5 = texture(data6, vec2(float(float(int(idx0/(196))%textureSize(data6, 0).x) + 0.5f)/float(textureSize(data6, 0).x), float(float(int(idx0/(196))/textureSize(data6, 0).x) + 0.5f)/float(textureSize(data6, 0).y))).r;
  float val6 = texture(data7, vec2(float(float(int(idx0/(196))%textureSize(data7, 0).x) + 0.5f)/float(textureSize(data7, 0).x), float(float(int(idx0/(196))/textureSize(data7, 0).x) + 0.5f)/float(textureSize(data7, 0).y))).r;
  float alu0 = float((((acc0-val2)*val3*sqrt(((1.0)/(val4+(1e-05)))))+val5));
  out_data = float((alu0*((1.0)/((1.0)+exp2((alu0*((-1.4426950408889634))))))*val6));
}`;

const r_112_196_672 = `#version 300 es
precision highp float;
precision highp int;
in vec2 uv;
uniform int w;
uniform sampler2D data1;
uniform sampler2D data2;
uniform sampler2D data3;
uniform sampler2D data4;
uniform sampler2D data5;
uniform sampler2D data6;
uniform sampler2D data7;
out float out_data;

void main() {
  int idx0 = int(gl_FragCoord.y-0.5f) * w + int(gl_FragCoord.x-0.5f); /* 21952 */
  float acc0 = (0.0);
  for (int ridx0 = (0); ridx0 < (672); ++ridx0) {
    float val0 = texture(data1, vec2(float(float(int((ridx0*(196))+(int(idx0)%int((196))))%textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).x), float(float(int((ridx0*(196))+(int(idx0)%int((196))))/textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).y))).r;
    float val1 = texture(data2, vec2(float(float(int(ridx0+((idx0/(196))*(672)))%textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).x), float(float(int(ridx0+((idx0/(196))*(672)))/textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).y))).r;
    acc0 = ((val0*val1)+acc0);
  }
  float val2 = texture(data3, vec2(float(float(int(idx0/(196))%textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).x), float(float(int(idx0/(196))/textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).y))).r;
  float val3 = texture(data4, vec2(float(float(int(idx0/(196))%textureSize(data4, 0).x) + 0.5f)/float(textureSize(data4, 0).x), float(float(int(idx0/(196))/textureSize(data4, 0).x) + 0.5f)/float(textureSize(data4, 0).y))).r;
  float val4 = texture(data5, vec2(float(float(int(idx0/(196))%textureSize(data5, 0).x) + 0.5f)/float(textureSize(data5, 0).x), float(float(int(idx0/(196))/textureSize(data5, 0).x) + 0.5f)/float(textureSize(data5, 0).y))).r;
  float val5 = texture(data6, vec2(float(float(int(idx0/(196))%textureSize(data6, 0).x) + 0.5f)/float(textureSize(data6, 0).x), float(float(int(idx0/(196))/textureSize(data6, 0).x) + 0.5f)/float(textureSize(data6, 0).y))).r;
  float val6 = texture(data7, vec2(float(float(int(idx0)%textureSize(data7, 0).x) + 0.5f)/float(textureSize(data7, 0).x), float(float(int(idx0)/textureSize(data7, 0).x) + 0.5f)/float(textureSize(data7, 0).y))).r;
  out_data = float((((acc0-val2)*val3*sqrt(((1.0)/(val4+(1e-05)))))+val5+val6));
}`;

const r_672_7_7_5_5 = `#version 300 es
precision highp float;
precision highp int;
in vec2 uv;
uniform int w;
uniform sampler2D data1;
uniform sampler2D data2;
out float out_data;

void main() {
  int idx0 = int(gl_FragCoord.y-0.5f) * w + int(gl_FragCoord.x-0.5f); /* 32928 */
  float acc0 = (0.0);
  for (int ridx0 = (0); ridx0 < (5); ++ridx0) {
    for (int ridx1 = (0); ridx1 < (5); ++ridx1) {
      float val0 = bool((float(((ridx1*((-1)))+((int(idx0)%int((7)))*((-2))))<(0))*float((ridx1+((int(idx0)%int((7)))*(2)))<(15))*float(((ridx0*((-1)))+((int((idx0/(7)))%int((7)))*((-2))))<(0))*float((ridx0+((int((idx0/(7)))%int((7)))*(2)))<(15))))?(texture(data1, vec2(float(float(int(ridx1+((int(idx0)%int((7)))*(2))+(ridx0*(14))+((int((idx0/(7)))%int((7)))*(28))+((idx0/(49))*(196))+((-15)))%textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).x), float(float(int(ridx1+((int(idx0)%int((7)))*(2))+(ridx0*(14))+((int((idx0/(7)))%int((7)))*(28))+((idx0/(49))*(196))+((-15)))/textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).y))).r):(0.0);
      float val1 = texture(data2, vec2(float(float(int((ridx0*(5))+ridx1+((idx0/(49))*(25)))%textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).x), float(float(int((ridx0*(5))+ridx1+((idx0/(49))*(25)))/textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).y))).r;
      acc0 = ((val0*val1)+acc0);
    }
  }
  out_data = float(acc0);
}`;

const r_672_49 = `#version 300 es
precision highp float;
precision highp int;
in vec2 uv;
uniform int w;
uniform sampler2D data1;
uniform sampler2D data2;
uniform sampler2D data3;
uniform sampler2D data4;
uniform sampler2D data5;
out float out_data;

void main() {
  int idx0 = int(gl_FragCoord.y-0.5f) * w + int(gl_FragCoord.x-0.5f); /* 672 */
  float acc0 = (0.0);
  for (int ridx0 = (0); ridx0 < (49); ++ridx0) {
    float val0 = texture(data1, vec2(float(float(int((idx0*(49))+ridx0)%textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).x), float(float(int((idx0*(49))+ridx0)/textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).y))).r;
    float val1 = texture(data2, vec2(float(float(int(idx0)%textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).x), float(float(int(idx0)/textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).y))).r;
    float val2 = texture(data3, vec2(float(float(int(idx0)%textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).x), float(float(int(idx0)/textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).y))).r;
    float val3 = texture(data4, vec2(float(float(int(idx0)%textureSize(data4, 0).x) + 0.5f)/float(textureSize(data4, 0).x), float(float(int(idx0)/textureSize(data4, 0).x) + 0.5f)/float(textureSize(data4, 0).y))).r;
    float val4 = texture(data5, vec2(float(float(int(idx0)%textureSize(data5, 0).x) + 0.5f)/float(textureSize(data5, 0).x), float(float(int(idx0)/textureSize(data5, 0).x) + 0.5f)/float(textureSize(data5, 0).y))).r;
    float alu0 = float((((val0-val1)*val2*sqrt(((1.0)/(val3+(1e-05)))))+val4));
    acc0 = ((alu0*((1.0)/((1.0)+exp2((alu0*((-1.4426950408889634)))))))+acc0);
  }
  out_data = float((acc0*(0.02040816326530612)));
}`;

const r_672_7_7_5_5n1 = `#version 300 es
precision highp float;
precision highp int;
in vec2 uv;
uniform int w;
uniform sampler2D data1;
uniform sampler2D data2;
uniform sampler2D data3;
uniform sampler2D data4;
uniform sampler2D data5;
uniform sampler2D data6;
uniform sampler2D data7;
out float out_data;

void main() {
  int idx0 = int(gl_FragCoord.y-0.5f) * w + int(gl_FragCoord.x-0.5f); /* 32928 */
  float acc0 = (0.0);
  for (int ridx0 = (0); ridx0 < (5); ++ridx0) {
    for (int ridx1 = (0); ridx1 < (5); ++ridx1) {
      float val0 = bool((float(((ridx1*((-1)))+((int(idx0)%int((7)))*((-2))))<(0))*float((ridx1+((int(idx0)%int((7)))*(2)))<(15))*float(((ridx0*((-1)))+((int((idx0/(7)))%int((7)))*((-2))))<(0))*float((ridx0+((int((idx0/(7)))%int((7)))*(2)))<(15))))?(texture(data1, vec2(float(float(int(ridx1+((int(idx0)%int((7)))*(2))+(ridx0*(14))+((int((idx0/(7)))%int((7)))*(28))+((idx0/(49))*(196))+((-15)))%textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).x), float(float(int(ridx1+((int(idx0)%int((7)))*(2))+(ridx0*(14))+((int((idx0/(7)))%int((7)))*(28))+((idx0/(49))*(196))+((-15)))/textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).y))).r):(0.0);
      float val1 = texture(data2, vec2(float(float(int((ridx0*(5))+ridx1+((idx0/(49))*(25)))%textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).x), float(float(int((ridx0*(5))+ridx1+((idx0/(49))*(25)))/textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).y))).r;
      acc0 = ((val0*val1)+acc0);
    }
  }
  float val2 = texture(data3, vec2(float(float(int(idx0/(49))%textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).x), float(float(int(idx0/(49))/textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).y))).r;
  float val3 = texture(data4, vec2(float(float(int(idx0/(49))%textureSize(data4, 0).x) + 0.5f)/float(textureSize(data4, 0).x), float(float(int(idx0/(49))/textureSize(data4, 0).x) + 0.5f)/float(textureSize(data4, 0).y))).r;
  float val4 = texture(data5, vec2(float(float(int(idx0/(49))%textureSize(data5, 0).x) + 0.5f)/float(textureSize(data5, 0).x), float(float(int(idx0/(49))/textureSize(data5, 0).x) + 0.5f)/float(textureSize(data5, 0).y))).r;
  float val5 = texture(data6, vec2(float(float(int(idx0/(49))%textureSize(data6, 0).x) + 0.5f)/float(textureSize(data6, 0).x), float(float(int(idx0/(49))/textureSize(data6, 0).x) + 0.5f)/float(textureSize(data6, 0).y))).r;
  float val6 = texture(data7, vec2(float(float(int(idx0/(49))%textureSize(data7, 0).x) + 0.5f)/float(textureSize(data7, 0).x), float(float(int(idx0/(49))/textureSize(data7, 0).x) + 0.5f)/float(textureSize(data7, 0).y))).r;
  float alu0 = float((((acc0-val2)*val3*sqrt(((1.0)/(val4+(1e-05)))))+val5));
  out_data = float((alu0*((1.0)/((1.0)+exp2((alu0*((-1.4426950408889634))))))*val6));
}`;

const r_192_49_672 = `#version 300 es
precision highp float;
precision highp int;
in vec2 uv;
uniform int w;
uniform sampler2D data1;
uniform sampler2D data2;
uniform sampler2D data3;
uniform sampler2D data4;
uniform sampler2D data5;
uniform sampler2D data6;
out float out_data;

void main() {
  int idx0 = int(gl_FragCoord.y-0.5f) * w + int(gl_FragCoord.x-0.5f); /* 9408 */
  float acc0 = (0.0);
  for (int ridx0 = (0); ridx0 < (672); ++ridx0) {
    float val0 = texture(data1, vec2(float(float(int((ridx0*(49))+(int(idx0)%int((49))))%textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).x), float(float(int((ridx0*(49))+(int(idx0)%int((49))))/textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).y))).r;
    float val1 = texture(data2, vec2(float(float(int(ridx0+((idx0/(49))*(672)))%textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).x), float(float(int(ridx0+((idx0/(49))*(672)))/textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).y))).r;
    acc0 = ((val0*val1)+acc0);
  }
  float val2 = texture(data3, vec2(float(float(int(idx0/(49))%textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).x), float(float(int(idx0/(49))/textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).y))).r;
  float val3 = texture(data4, vec2(float(float(int(idx0/(49))%textureSize(data4, 0).x) + 0.5f)/float(textureSize(data4, 0).x), float(float(int(idx0/(49))/textureSize(data4, 0).x) + 0.5f)/float(textureSize(data4, 0).y))).r;
  float val4 = texture(data5, vec2(float(float(int(idx0/(49))%textureSize(data5, 0).x) + 0.5f)/float(textureSize(data5, 0).x), float(float(int(idx0/(49))/textureSize(data5, 0).x) + 0.5f)/float(textureSize(data5, 0).y))).r;
  float val5 = texture(data6, vec2(float(float(int(idx0/(49))%textureSize(data6, 0).x) + 0.5f)/float(textureSize(data6, 0).x), float(float(int(idx0/(49))/textureSize(data6, 0).x) + 0.5f)/float(textureSize(data6, 0).y))).r;
  out_data = float((((acc0-val2)*val3*sqrt(((1.0)/(val4+(1e-05)))))+val5));
}`;

const r_1152_49_192 = `#version 300 es
precision highp float;
precision highp int;
in vec2 uv;
uniform int w;
uniform sampler2D data1;
uniform sampler2D data2;
uniform sampler2D data3;
uniform sampler2D data4;
uniform sampler2D data5;
uniform sampler2D data6;
out float out_data;

void main() {
  int idx0 = int(gl_FragCoord.y-0.5f) * w + int(gl_FragCoord.x-0.5f); /* 56448 */
  float acc0 = (0.0);
  for (int ridx0 = (0); ridx0 < (192); ++ridx0) {
    float val0 = texture(data1, vec2(float(float(int((ridx0*(49))+(int(idx0)%int((49))))%textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).x), float(float(int((ridx0*(49))+(int(idx0)%int((49))))/textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).y))).r;
    float val1 = texture(data2, vec2(float(float(int(ridx0+((idx0/(49))*(192)))%textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).x), float(float(int(ridx0+((idx0/(49))*(192)))/textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).y))).r;
    acc0 = ((val0*val1)+acc0);
  }
  float val2 = texture(data3, vec2(float(float(int(idx0/(49))%textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).x), float(float(int(idx0/(49))/textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).y))).r;
  float val3 = texture(data4, vec2(float(float(int(idx0/(49))%textureSize(data4, 0).x) + 0.5f)/float(textureSize(data4, 0).x), float(float(int(idx0/(49))/textureSize(data4, 0).x) + 0.5f)/float(textureSize(data4, 0).y))).r;
  float val4 = texture(data5, vec2(float(float(int(idx0/(49))%textureSize(data5, 0).x) + 0.5f)/float(textureSize(data5, 0).x), float(float(int(idx0/(49))/textureSize(data5, 0).x) + 0.5f)/float(textureSize(data5, 0).y))).r;
  float val5 = texture(data6, vec2(float(float(int(idx0/(49))%textureSize(data6, 0).x) + 0.5f)/float(textureSize(data6, 0).x), float(float(int(idx0/(49))/textureSize(data6, 0).x) + 0.5f)/float(textureSize(data6, 0).y))).r;
  float alu0 = float((((acc0-val2)*val3*sqrt(((1.0)/(val4+(1e-05)))))+val5));
  out_data = float((alu0*((1.0)/((1.0)+exp2((alu0*((-1.4426950408889634))))))));
}`;

const r_1152_7_7_5_5 = `#version 300 es
precision highp float;
precision highp int;
in vec2 uv;
uniform int w;
uniform sampler2D data1;
uniform sampler2D data2;
out float out_data;

void main() {
  int idx0 = int(gl_FragCoord.y-0.5f) * w + int(gl_FragCoord.x-0.5f); /* 56448 */
  float acc0 = (0.0);
  for (int ridx0 = (0); ridx0 < (5); ++ridx0) {
    for (int ridx1 = (0); ridx1 < (5); ++ridx1) {
      float val0 = bool((float(((ridx1*((-1)))+((int(idx0)%int((7)))*((-1))))<((-1)))*float((ridx1+(int(idx0)%int((7))))<(9))*float(((ridx0*((-1)))+((int((idx0/(7)))%int((7)))*((-1))))<((-1)))*float((ridx0+(int((idx0/(7)))%int((7))))<(9))))?(texture(data1, vec2(float(float(int(ridx1+(int(idx0)%int((7)))+(ridx0*(7))+((int((idx0/(7)))%int((7)))*(7))+((idx0/(49))*(49))+((-16)))%textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).x), float(float(int(ridx1+(int(idx0)%int((7)))+(ridx0*(7))+((int((idx0/(7)))%int((7)))*(7))+((idx0/(49))*(49))+((-16)))/textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).y))).r):(0.0);
      float val1 = texture(data2, vec2(float(float(int((ridx0*(5))+ridx1+((idx0/(49))*(25)))%textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).x), float(float(int((ridx0*(5))+ridx1+((idx0/(49))*(25)))/textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).y))).r;
      acc0 = ((val0*val1)+acc0);
    }
  }
  out_data = float(acc0);
}`;

const r_1152_49 = `#version 300 es
precision highp float;
precision highp int;
in vec2 uv;
uniform int w;
uniform sampler2D data1;
uniform sampler2D data2;
uniform sampler2D data3;
uniform sampler2D data4;
uniform sampler2D data5;
out float out_data;

void main() {
  int idx0 = int(gl_FragCoord.y-0.5f) * w + int(gl_FragCoord.x-0.5f); /* 1152 */
  float acc0 = (0.0);
  for (int ridx0 = (0); ridx0 < (49); ++ridx0) {
    float val0 = texture(data1, vec2(float(float(int((idx0*(49))+ridx0)%textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).x), float(float(int((idx0*(49))+ridx0)/textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).y))).r;
    float val1 = texture(data2, vec2(float(float(int(idx0)%textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).x), float(float(int(idx0)/textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).y))).r;
    float val2 = texture(data3, vec2(float(float(int(idx0)%textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).x), float(float(int(idx0)/textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).y))).r;
    float val3 = texture(data4, vec2(float(float(int(idx0)%textureSize(data4, 0).x) + 0.5f)/float(textureSize(data4, 0).x), float(float(int(idx0)/textureSize(data4, 0).x) + 0.5f)/float(textureSize(data4, 0).y))).r;
    float val4 = texture(data5, vec2(float(float(int(idx0)%textureSize(data5, 0).x) + 0.5f)/float(textureSize(data5, 0).x), float(float(int(idx0)/textureSize(data5, 0).x) + 0.5f)/float(textureSize(data5, 0).y))).r;
    float alu0 = float((((val0-val1)*val2*sqrt(((1.0)/(val3+(1e-05)))))+val4));
    acc0 = ((alu0*((1.0)/((1.0)+exp2((alu0*((-1.4426950408889634)))))))+acc0);
  }
  out_data = float((acc0*(0.02040816326530612)));
}`;

const r_48_1152 = `#version 300 es
precision highp float;
precision highp int;
in vec2 uv;
uniform int w;
uniform sampler2D data1;
uniform sampler2D data2;
uniform sampler2D data3;
out float out_data;

void main() {
  int idx0 = int(gl_FragCoord.y-0.5f) * w + int(gl_FragCoord.x-0.5f); /* 48 */
  float acc0 = (0.0);
  for (int ridx0 = (0); ridx0 < (1152); ++ridx0) {
    float val0 = texture(data1, vec2(float(float(int(ridx0)%textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).x), float(float(int(ridx0)/textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).y))).r;
    float val1 = texture(data2, vec2(float(float(int((idx0*(1152))+ridx0)%textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).x), float(float(int((idx0*(1152))+ridx0)/textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).y))).r;
    acc0 = ((val0*val1)+acc0);
  }
  float val2 = texture(data3, vec2(float(float(int(idx0)%textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).x), float(float(int(idx0)/textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).y))).r;
  float alu0 = float((acc0+val2));
  out_data = float((alu0*((1.0)/((1.0)+exp2((alu0*((-1.4426950408889634))))))));
}`;

const r_1152_48 = `#version 300 es
precision highp float;
precision highp int;
in vec2 uv;
uniform int w;
uniform sampler2D data1;
uniform sampler2D data2;
uniform sampler2D data3;
out float out_data;

void main() {
  int idx0 = int(gl_FragCoord.y-0.5f) * w + int(gl_FragCoord.x-0.5f); /* 1152 */
  float acc0 = (0.0);
  for (int ridx0 = (0); ridx0 < (48); ++ridx0) {
    float val0 = texture(data1, vec2(float(float(int(ridx0)%textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).x), float(float(int(ridx0)/textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).y))).r;
    float val1 = texture(data2, vec2(float(float(int((idx0*(48))+ridx0)%textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).x), float(float(int((idx0*(48))+ridx0)/textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).y))).r;
    acc0 = ((val0*val1)+acc0);
  }
  float val2 = texture(data3, vec2(float(float(int(idx0)%textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).x), float(float(int(idx0)/textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).y))).r;
  out_data = float(((1.0)/((1.0)+exp2(((acc0+val2)*((-1.4426950408889634)))))));
}`;

const r_1152_7_7_5_5n1 = `#version 300 es
precision highp float;
precision highp int;
in vec2 uv;
uniform int w;
uniform sampler2D data1;
uniform sampler2D data2;
uniform sampler2D data3;
uniform sampler2D data4;
uniform sampler2D data5;
uniform sampler2D data6;
uniform sampler2D data7;
out float out_data;

void main() {
  int idx0 = int(gl_FragCoord.y-0.5f) * w + int(gl_FragCoord.x-0.5f); /* 56448 */
  float acc0 = (0.0);
  for (int ridx0 = (0); ridx0 < (5); ++ridx0) {
    for (int ridx1 = (0); ridx1 < (5); ++ridx1) {
      float val0 = bool((float(((ridx1*((-1)))+((int(idx0)%int((7)))*((-1))))<((-1)))*float((ridx1+(int(idx0)%int((7))))<(9))*float(((ridx0*((-1)))+((int((idx0/(7)))%int((7)))*((-1))))<((-1)))*float((ridx0+(int((idx0/(7)))%int((7))))<(9))))?(texture(data1, vec2(float(float(int(ridx1+(int(idx0)%int((7)))+(ridx0*(7))+((int((idx0/(7)))%int((7)))*(7))+((idx0/(49))*(49))+((-16)))%textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).x), float(float(int(ridx1+(int(idx0)%int((7)))+(ridx0*(7))+((int((idx0/(7)))%int((7)))*(7))+((idx0/(49))*(49))+((-16)))/textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).y))).r):(0.0);
      float val1 = texture(data2, vec2(float(float(int((ridx0*(5))+ridx1+((idx0/(49))*(25)))%textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).x), float(float(int((ridx0*(5))+ridx1+((idx0/(49))*(25)))/textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).y))).r;
      acc0 = ((val0*val1)+acc0);
    }
  }
  float val2 = texture(data3, vec2(float(float(int(idx0/(49))%textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).x), float(float(int(idx0/(49))/textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).y))).r;
  float val3 = texture(data4, vec2(float(float(int(idx0/(49))%textureSize(data4, 0).x) + 0.5f)/float(textureSize(data4, 0).x), float(float(int(idx0/(49))/textureSize(data4, 0).x) + 0.5f)/float(textureSize(data4, 0).y))).r;
  float val4 = texture(data5, vec2(float(float(int(idx0/(49))%textureSize(data5, 0).x) + 0.5f)/float(textureSize(data5, 0).x), float(float(int(idx0/(49))/textureSize(data5, 0).x) + 0.5f)/float(textureSize(data5, 0).y))).r;
  float val5 = texture(data6, vec2(float(float(int(idx0/(49))%textureSize(data6, 0).x) + 0.5f)/float(textureSize(data6, 0).x), float(float(int(idx0/(49))/textureSize(data6, 0).x) + 0.5f)/float(textureSize(data6, 0).y))).r;
  float val6 = texture(data7, vec2(float(float(int(idx0/(49))%textureSize(data7, 0).x) + 0.5f)/float(textureSize(data7, 0).x), float(float(int(idx0/(49))/textureSize(data7, 0).x) + 0.5f)/float(textureSize(data7, 0).y))).r;
  float alu0 = float((((acc0-val2)*val3*sqrt(((1.0)/(val4+(1e-05)))))+val5));
  out_data = float((alu0*((1.0)/((1.0)+exp2((alu0*((-1.4426950408889634))))))*val6));
}`;

const r_192_49_1152 = `#version 300 es
precision highp float;
precision highp int;
in vec2 uv;
uniform int w;
uniform sampler2D data1;
uniform sampler2D data2;
uniform sampler2D data3;
uniform sampler2D data4;
uniform sampler2D data5;
uniform sampler2D data6;
uniform sampler2D data7;
out float out_data;

void main() {
  int idx0 = int(gl_FragCoord.y-0.5f) * w + int(gl_FragCoord.x-0.5f); /* 9408 */
  float acc0 = (0.0);
  for (int ridx0 = (0); ridx0 < (1152); ++ridx0) {
    float val0 = texture(data1, vec2(float(float(int((ridx0*(49))+(int(idx0)%int((49))))%textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).x), float(float(int((ridx0*(49))+(int(idx0)%int((49))))/textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).y))).r;
    float val1 = texture(data2, vec2(float(float(int(ridx0+((idx0/(49))*(1152)))%textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).x), float(float(int(ridx0+((idx0/(49))*(1152)))/textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).y))).r;
    acc0 = ((val0*val1)+acc0);
  }
  float val2 = texture(data3, vec2(float(float(int(idx0/(49))%textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).x), float(float(int(idx0/(49))/textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).y))).r;
  float val3 = texture(data4, vec2(float(float(int(idx0/(49))%textureSize(data4, 0).x) + 0.5f)/float(textureSize(data4, 0).x), float(float(int(idx0/(49))/textureSize(data4, 0).x) + 0.5f)/float(textureSize(data4, 0).y))).r;
  float val4 = texture(data5, vec2(float(float(int(idx0/(49))%textureSize(data5, 0).x) + 0.5f)/float(textureSize(data5, 0).x), float(float(int(idx0/(49))/textureSize(data5, 0).x) + 0.5f)/float(textureSize(data5, 0).y))).r;
  float val5 = texture(data6, vec2(float(float(int(idx0/(49))%textureSize(data6, 0).x) + 0.5f)/float(textureSize(data6, 0).x), float(float(int(idx0/(49))/textureSize(data6, 0).x) + 0.5f)/float(textureSize(data6, 0).y))).r;
  float val6 = texture(data7, vec2(float(float(int(idx0)%textureSize(data7, 0).x) + 0.5f)/float(textureSize(data7, 0).x), float(float(int(idx0)/textureSize(data7, 0).x) + 0.5f)/float(textureSize(data7, 0).y))).r;
  out_data = float((((acc0-val2)*val3*sqrt(((1.0)/(val4+(1e-05)))))+val5+val6));
}`;

const r_1152_7_7_3_3 = `#version 300 es
precision highp float;
precision highp int;
in vec2 uv;
uniform int w;
uniform sampler2D data1;
uniform sampler2D data2;
out float out_data;

void main() {
  int idx0 = int(gl_FragCoord.y-0.5f) * w + int(gl_FragCoord.x-0.5f); /* 56448 */
  float acc0 = (0.0);
  for (int ridx0 = (0); ridx0 < (3); ++ridx0) {
    for (int ridx1 = (0); ridx1 < (3); ++ridx1) {
      float val0 = bool((float(((ridx1*((-1)))+((int(idx0)%int((7)))*((-1))))<(0))*float((ridx1+(int(idx0)%int((7))))<(8))*float(((ridx0*((-1)))+((int((idx0/(7)))%int((7)))*((-1))))<(0))*float((ridx0+(int((idx0/(7)))%int((7))))<(8))))?(texture(data1, vec2(float(float(int(ridx1+(int(idx0)%int((7)))+(ridx0*(7))+((int((idx0/(7)))%int((7)))*(7))+((idx0/(49))*(49))+((-8)))%textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).x), float(float(int(ridx1+(int(idx0)%int((7)))+(ridx0*(7))+((int((idx0/(7)))%int((7)))*(7))+((idx0/(49))*(49))+((-8)))/textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).y))).r):(0.0);
      float val1 = texture(data2, vec2(float(float(int((ridx0*(3))+ridx1+((idx0/(49))*(9)))%textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).x), float(float(int((ridx0*(3))+ridx1+((idx0/(49))*(9)))/textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).y))).r;
      acc0 = ((val0*val1)+acc0);
    }
  }
  out_data = float(acc0);
}`;

const r_1152_7_7_3_3n1 = `#version 300 es
precision highp float;
precision highp int;
in vec2 uv;
uniform int w;
uniform sampler2D data1;
uniform sampler2D data2;
uniform sampler2D data3;
uniform sampler2D data4;
uniform sampler2D data5;
uniform sampler2D data6;
uniform sampler2D data7;
out float out_data;

void main() {
  int idx0 = int(gl_FragCoord.y-0.5f) * w + int(gl_FragCoord.x-0.5f); /* 56448 */
  float acc0 = (0.0);
  for (int ridx0 = (0); ridx0 < (3); ++ridx0) {
    for (int ridx1 = (0); ridx1 < (3); ++ridx1) {
      float val0 = bool((float(((ridx1*((-1)))+((int(idx0)%int((7)))*((-1))))<(0))*float((ridx1+(int(idx0)%int((7))))<(8))*float(((ridx0*((-1)))+((int((idx0/(7)))%int((7)))*((-1))))<(0))*float((ridx0+(int((idx0/(7)))%int((7))))<(8))))?(texture(data1, vec2(float(float(int(ridx1+(int(idx0)%int((7)))+(ridx0*(7))+((int((idx0/(7)))%int((7)))*(7))+((idx0/(49))*(49))+((-8)))%textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).x), float(float(int(ridx1+(int(idx0)%int((7)))+(ridx0*(7))+((int((idx0/(7)))%int((7)))*(7))+((idx0/(49))*(49))+((-8)))/textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).y))).r):(0.0);
      float val1 = texture(data2, vec2(float(float(int((ridx0*(3))+ridx1+((idx0/(49))*(9)))%textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).x), float(float(int((ridx0*(3))+ridx1+((idx0/(49))*(9)))/textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).y))).r;
      acc0 = ((val0*val1)+acc0);
    }
  }
  float val2 = texture(data3, vec2(float(float(int(idx0/(49))%textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).x), float(float(int(idx0/(49))/textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).y))).r;
  float val3 = texture(data4, vec2(float(float(int(idx0/(49))%textureSize(data4, 0).x) + 0.5f)/float(textureSize(data4, 0).x), float(float(int(idx0/(49))/textureSize(data4, 0).x) + 0.5f)/float(textureSize(data4, 0).y))).r;
  float val4 = texture(data5, vec2(float(float(int(idx0/(49))%textureSize(data5, 0).x) + 0.5f)/float(textureSize(data5, 0).x), float(float(int(idx0/(49))/textureSize(data5, 0).x) + 0.5f)/float(textureSize(data5, 0).y))).r;
  float val5 = texture(data6, vec2(float(float(int(idx0/(49))%textureSize(data6, 0).x) + 0.5f)/float(textureSize(data6, 0).x), float(float(int(idx0/(49))/textureSize(data6, 0).x) + 0.5f)/float(textureSize(data6, 0).y))).r;
  float val6 = texture(data7, vec2(float(float(int(idx0/(49))%textureSize(data7, 0).x) + 0.5f)/float(textureSize(data7, 0).x), float(float(int(idx0/(49))/textureSize(data7, 0).x) + 0.5f)/float(textureSize(data7, 0).y))).r;
  float alu0 = float((((acc0-val2)*val3*sqrt(((1.0)/(val4+(1e-05)))))+val5));
  out_data = float((alu0*((1.0)/((1.0)+exp2((alu0*((-1.4426950408889634))))))*val6));
}`;

const r_320_49_1152 = `#version 300 es
precision highp float;
precision highp int;
in vec2 uv;
uniform int w;
uniform sampler2D data1;
uniform sampler2D data2;
uniform sampler2D data3;
uniform sampler2D data4;
uniform sampler2D data5;
uniform sampler2D data6;
out float out_data;

void main() {
  int idx0 = int(gl_FragCoord.y-0.5f) * w + int(gl_FragCoord.x-0.5f); /* 15680 */
  float acc0 = (0.0);
  for (int ridx0 = (0); ridx0 < (1152); ++ridx0) {
    float val0 = texture(data1, vec2(float(float(int((ridx0*(49))+(int(idx0)%int((49))))%textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).x), float(float(int((ridx0*(49))+(int(idx0)%int((49))))/textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).y))).r;
    float val1 = texture(data2, vec2(float(float(int(ridx0+((idx0/(49))*(1152)))%textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).x), float(float(int(ridx0+((idx0/(49))*(1152)))/textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).y))).r;
    acc0 = ((val0*val1)+acc0);
  }
  float val2 = texture(data3, vec2(float(float(int(idx0/(49))%textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).x), float(float(int(idx0/(49))/textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).y))).r;
  float val3 = texture(data4, vec2(float(float(int(idx0/(49))%textureSize(data4, 0).x) + 0.5f)/float(textureSize(data4, 0).x), float(float(int(idx0/(49))/textureSize(data4, 0).x) + 0.5f)/float(textureSize(data4, 0).y))).r;
  float val4 = texture(data5, vec2(float(float(int(idx0/(49))%textureSize(data5, 0).x) + 0.5f)/float(textureSize(data5, 0).x), float(float(int(idx0/(49))/textureSize(data5, 0).x) + 0.5f)/float(textureSize(data5, 0).y))).r;
  float val5 = texture(data6, vec2(float(float(int(idx0/(49))%textureSize(data6, 0).x) + 0.5f)/float(textureSize(data6, 0).x), float(float(int(idx0/(49))/textureSize(data6, 0).x) + 0.5f)/float(textureSize(data6, 0).y))).r;
  out_data = float((((acc0-val2)*val3*sqrt(((1.0)/(val4+(1e-05)))))+val5));
}`;

const r_1280_49_320 = `#version 300 es
precision highp float;
precision highp int;
in vec2 uv;
uniform int w;
uniform sampler2D data1;
uniform sampler2D data2;
out float out_data;

void main() {
  int idx0 = int(gl_FragCoord.y-0.5f) * w + int(gl_FragCoord.x-0.5f); /* 62720 */
  float acc0 = (0.0);
  for (int ridx0 = (0); ridx0 < (320); ++ridx0) {
    float val0 = texture(data1, vec2(float(float(int((ridx0*(49))+(int(idx0)%int((49))))%textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).x), float(float(int((ridx0*(49))+(int(idx0)%int((49))))/textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).y))).r;
    float val1 = texture(data2, vec2(float(float(int(ridx0+((idx0/(49))*(320)))%textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).x), float(float(int(ridx0+((idx0/(49))*(320)))/textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).y))).r;
    acc0 = ((val0*val1)+acc0);
  }
  out_data = float(acc0);
}`;

const r_1280_49 = `#version 300 es
precision highp float;
precision highp int;
in vec2 uv;
uniform int w;
uniform sampler2D data1;
uniform sampler2D data2;
uniform sampler2D data3;
uniform sampler2D data4;
uniform sampler2D data5;
out float out_data;

void main() {
  int idx0 = int(gl_FragCoord.y-0.5f) * w + int(gl_FragCoord.x-0.5f); /* 1280 */
  float acc0 = (0.0);
  for (int ridx0 = (0); ridx0 < (49); ++ridx0) {
    float val0 = texture(data1, vec2(float(float(int((idx0*(49))+ridx0)%textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).x), float(float(int((idx0*(49))+ridx0)/textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).y))).r;
    float val1 = texture(data2, vec2(float(float(int(idx0)%textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).x), float(float(int(idx0)/textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).y))).r;
    float val2 = texture(data3, vec2(float(float(int(idx0)%textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).x), float(float(int(idx0)/textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).y))).r;
    float val3 = texture(data4, vec2(float(float(int(idx0)%textureSize(data4, 0).x) + 0.5f)/float(textureSize(data4, 0).x), float(float(int(idx0)/textureSize(data4, 0).x) + 0.5f)/float(textureSize(data4, 0).y))).r;
    float val4 = texture(data5, vec2(float(float(int(idx0)%textureSize(data5, 0).x) + 0.5f)/float(textureSize(data5, 0).x), float(float(int(idx0)/textureSize(data5, 0).x) + 0.5f)/float(textureSize(data5, 0).y))).r;
    float alu0 = float((((val0-val1)*val2*sqrt(((1.0)/(val3+(1e-05)))))+val4));
    acc0 = ((alu0*((1.0)/((1.0)+exp2((alu0*((-1.4426950408889634)))))))+acc0);
  }
  out_data = float((acc0*(0.02040816326530612)));
}`;

const r_1000_1280 = `#version 300 es
precision highp float;
precision highp int;
in vec2 uv;
uniform int w;
uniform sampler2D data1;
uniform sampler2D data2;
uniform sampler2D data3;
out float out_data;

void main() {
  int idx0 = int(gl_FragCoord.y-0.5f) * w + int(gl_FragCoord.x-0.5f); /* 1000 */
  float acc0 = (0.0);
  for (int ridx0 = (0); ridx0 < (1280); ++ridx0) {
    float val0 = texture(data1, vec2(float(float(int(ridx0)%textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).x), float(float(int(ridx0)/textureSize(data1, 0).x) + 0.5f)/float(textureSize(data1, 0).y))).r;
    float val1 = texture(data2, vec2(float(float(int(idx0+(ridx0*(1000)))%textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).x), float(float(int(idx0+(ridx0*(1000)))/textureSize(data2, 0).x) + 0.5f)/float(textureSize(data2, 0).y))).r;
    acc0 = ((val0*val1)+acc0);
  }
  float val2 = texture(data3, vec2(float(float(int(idx0)%textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).x), float(float(int(idx0)/textureSize(data3, 0).x) + 0.5f)/float(textureSize(data3, 0).y))).r;
  out_data = float((acc0+val2));
}`;
const buf_0 = createTexture(gl, 401408.0);;
    const input0 = createTexture(gl, 150528.0);;
    const buf_1 = createTexture(gl, 864.0, getTensorBuffer(safetensor, metadata['_conv_stem']));
    const buf_2 = createTexture(gl, 32.0, getTensorBuffer(safetensor, metadata['_bn0.running_mean']));
    const buf_3 = createTexture(gl, 32.0, getTensorBuffer(safetensor, metadata['_bn0.weight']));
    const buf_4 = createTexture(gl, 32.0, getTensorBuffer(safetensor, metadata['_bn0.running_var']));
    const buf_5 = createTexture(gl, 32.0, getTensorBuffer(safetensor, metadata['_bn0.bias']));
    const buf_6 = createTexture(gl, 401408.0);;
    const buf_7 = createTexture(gl, 288.0, getTensorBuffer(safetensor, metadata['_blocks.0._depthwise_conv']));
    const buf_8 = createTexture(gl, 32.0);;
    const buf_9 = createTexture(gl, 32.0, getTensorBuffer(safetensor, metadata['_blocks.0._bn1.running_mean']));
    const buf_10 = createTexture(gl, 32.0, getTensorBuffer(safetensor, metadata['_blocks.0._bn1.weight']));
    const buf_11 = createTexture(gl, 32.0, getTensorBuffer(safetensor, metadata['_blocks.0._bn1.running_var']));
    const buf_12 = createTexture(gl, 32.0, getTensorBuffer(safetensor, metadata['_blocks.0._bn1.bias']));
    const buf_13 = createTexture(gl, 8.0);;
    const buf_14 = createTexture(gl, 256.0, getTensorBuffer(safetensor, metadata['_blocks.0._se_reduce']));
    const buf_15 = createTexture(gl, 8.0, getTensorBuffer(safetensor, metadata['_blocks.0._se_reduce_bias']));
    const buf_16 = createTexture(gl, 256.0, getTensorBuffer(safetensor, metadata['_blocks.0._se_expand']));
    const buf_17 = createTexture(gl, 32.0, getTensorBuffer(safetensor, metadata['_blocks.0._se_expand_bias']));
    const buf_18 = createTexture(gl, 401408.0);;
    const buf_19 = createTexture(gl, 200704.0);;
    const buf_20 = createTexture(gl, 512.0, getTensorBuffer(safetensor, metadata['_blocks.0._project_conv']));
    const buf_21 = createTexture(gl, 16.0, getTensorBuffer(safetensor, metadata['_blocks.0._bn2.running_mean']));
    const buf_22 = createTexture(gl, 16.0, getTensorBuffer(safetensor, metadata['_blocks.0._bn2.weight']));
    const buf_23 = createTexture(gl, 16.0, getTensorBuffer(safetensor, metadata['_blocks.0._bn2.running_var']));
    const buf_24 = createTexture(gl, 16.0, getTensorBuffer(safetensor, metadata['_blocks.0._bn2.bias']));
    const buf_25 = createTexture(gl, 1204224.0);;
    const buf_26 = createTexture(gl, 1536.0, getTensorBuffer(safetensor, metadata['_blocks.1._expand_conv']));
    const buf_27 = createTexture(gl, 96.0, getTensorBuffer(safetensor, metadata['_blocks.1._bn0.running_mean']));
    const buf_28 = createTexture(gl, 96.0, getTensorBuffer(safetensor, metadata['_blocks.1._bn0.weight']));
    const buf_29 = createTexture(gl, 96.0, getTensorBuffer(safetensor, metadata['_blocks.1._bn0.running_var']));
    const buf_30 = createTexture(gl, 96.0, getTensorBuffer(safetensor, metadata['_blocks.1._bn0.bias']));
    const buf_31 = createTexture(gl, 301056.0);;
    const buf_32 = createTexture(gl, 864.0, getTensorBuffer(safetensor, metadata['_blocks.1._depthwise_conv']));
    const buf_33 = createTexture(gl, 96.0);;
    const buf_34 = createTexture(gl, 96.0, getTensorBuffer(safetensor, metadata['_blocks.1._bn1.running_mean']));
    const buf_35 = createTexture(gl, 96.0, getTensorBuffer(safetensor, metadata['_blocks.1._bn1.weight']));
    const buf_36 = createTexture(gl, 96.0, getTensorBuffer(safetensor, metadata['_blocks.1._bn1.running_var']));
    const buf_37 = createTexture(gl, 96.0, getTensorBuffer(safetensor, metadata['_blocks.1._bn1.bias']));
    const buf_38 = createTexture(gl, 4.0);;
    const buf_39 = createTexture(gl, 384.0, getTensorBuffer(safetensor, metadata['_blocks.1._se_reduce']));
    const buf_40 = createTexture(gl, 4.0, getTensorBuffer(safetensor, metadata['_blocks.1._se_reduce_bias']));
    const buf_41 = createTexture(gl, 384.0, getTensorBuffer(safetensor, metadata['_blocks.1._se_expand']));
    const buf_42 = createTexture(gl, 96.0, getTensorBuffer(safetensor, metadata['_blocks.1._se_expand_bias']));
    const buf_43 = createTexture(gl, 301056.0);;
    const buf_44 = createTexture(gl, 75264.0);;
    const buf_45 = createTexture(gl, 2304.0, getTensorBuffer(safetensor, metadata['_blocks.1._project_conv']));
    const buf_46 = createTexture(gl, 24.0, getTensorBuffer(safetensor, metadata['_blocks.1._bn2.running_mean']));
    const buf_47 = createTexture(gl, 24.0, getTensorBuffer(safetensor, metadata['_blocks.1._bn2.weight']));
    const buf_48 = createTexture(gl, 24.0, getTensorBuffer(safetensor, metadata['_blocks.1._bn2.running_var']));
    const buf_49 = createTexture(gl, 24.0, getTensorBuffer(safetensor, metadata['_blocks.1._bn2.bias']));
    const buf_50 = createTexture(gl, 451584.0);;
    const buf_51 = createTexture(gl, 3456.0, getTensorBuffer(safetensor, metadata['_blocks.2._expand_conv']));
    const buf_52 = createTexture(gl, 144.0, getTensorBuffer(safetensor, metadata['_blocks.2._bn0.running_mean']));
    const buf_53 = createTexture(gl, 144.0, getTensorBuffer(safetensor, metadata['_blocks.2._bn0.weight']));
    const buf_54 = createTexture(gl, 144.0, getTensorBuffer(safetensor, metadata['_blocks.2._bn0.running_var']));
    const buf_55 = createTexture(gl, 144.0, getTensorBuffer(safetensor, metadata['_blocks.2._bn0.bias']));
    const buf_56 = createTexture(gl, 451584.0);;
    const buf_57 = createTexture(gl, 1296.0, getTensorBuffer(safetensor, metadata['_blocks.2._depthwise_conv']));
    const buf_58 = createTexture(gl, 144.0);;
    const buf_59 = createTexture(gl, 144.0, getTensorBuffer(safetensor, metadata['_blocks.2._bn1.running_mean']));
    const buf_60 = createTexture(gl, 144.0, getTensorBuffer(safetensor, metadata['_blocks.2._bn1.weight']));
    const buf_61 = createTexture(gl, 144.0, getTensorBuffer(safetensor, metadata['_blocks.2._bn1.running_var']));
    const buf_62 = createTexture(gl, 144.0, getTensorBuffer(safetensor, metadata['_blocks.2._bn1.bias']));
    const buf_63 = createTexture(gl, 6.0);;
    const buf_64 = createTexture(gl, 864.0, getTensorBuffer(safetensor, metadata['_blocks.2._se_reduce']));
    const buf_65 = createTexture(gl, 6.0, getTensorBuffer(safetensor, metadata['_blocks.2._se_reduce_bias']));
    const buf_66 = createTexture(gl, 864.0, getTensorBuffer(safetensor, metadata['_blocks.2._se_expand']));
    const buf_67 = createTexture(gl, 144.0, getTensorBuffer(safetensor, metadata['_blocks.2._se_expand_bias']));
    const buf_68 = createTexture(gl, 451584.0);;
    const buf_69 = createTexture(gl, 75264.0);;
    const buf_70 = createTexture(gl, 3456.0, getTensorBuffer(safetensor, metadata['_blocks.2._project_conv']));
    const buf_71 = createTexture(gl, 24.0, getTensorBuffer(safetensor, metadata['_blocks.2._bn2.running_mean']));
    const buf_72 = createTexture(gl, 24.0, getTensorBuffer(safetensor, metadata['_blocks.2._bn2.weight']));
    const buf_73 = createTexture(gl, 24.0, getTensorBuffer(safetensor, metadata['_blocks.2._bn2.running_var']));
    const buf_74 = createTexture(gl, 24.0, getTensorBuffer(safetensor, metadata['_blocks.2._bn2.bias']));
    const buf_75 = createTexture(gl, 3456.0, getTensorBuffer(safetensor, metadata['_blocks.3._expand_conv']));
    const buf_76 = createTexture(gl, 144.0, getTensorBuffer(safetensor, metadata['_blocks.3._bn0.running_mean']));
    const buf_77 = createTexture(gl, 144.0, getTensorBuffer(safetensor, metadata['_blocks.3._bn0.weight']));
    const buf_78 = createTexture(gl, 144.0, getTensorBuffer(safetensor, metadata['_blocks.3._bn0.running_var']));
    const buf_79 = createTexture(gl, 144.0, getTensorBuffer(safetensor, metadata['_blocks.3._bn0.bias']));
    const buf_80 = createTexture(gl, 112896.0);;
    const buf_81 = createTexture(gl, 3600.0, getTensorBuffer(safetensor, metadata['_blocks.3._depthwise_conv']));
    const buf_82 = createTexture(gl, 144.0, getTensorBuffer(safetensor, metadata['_blocks.3._bn1.running_mean']));
    const buf_83 = createTexture(gl, 144.0, getTensorBuffer(safetensor, metadata['_blocks.3._bn1.weight']));
    const buf_84 = createTexture(gl, 144.0, getTensorBuffer(safetensor, metadata['_blocks.3._bn1.running_var']));
    const buf_85 = createTexture(gl, 144.0, getTensorBuffer(safetensor, metadata['_blocks.3._bn1.bias']));
    const buf_86 = createTexture(gl, 864.0, getTensorBuffer(safetensor, metadata['_blocks.3._se_reduce']));
    const buf_87 = createTexture(gl, 6.0, getTensorBuffer(safetensor, metadata['_blocks.3._se_reduce_bias']));
    const buf_88 = createTexture(gl, 864.0, getTensorBuffer(safetensor, metadata['_blocks.3._se_expand']));
    const buf_89 = createTexture(gl, 144.0, getTensorBuffer(safetensor, metadata['_blocks.3._se_expand_bias']));
    const buf_90 = createTexture(gl, 112896.0);;
    const buf_91 = createTexture(gl, 31360.0);;
    const buf_92 = createTexture(gl, 5760.0, getTensorBuffer(safetensor, metadata['_blocks.3._project_conv']));
    const buf_93 = createTexture(gl, 40.0, getTensorBuffer(safetensor, metadata['_blocks.3._bn2.running_mean']));
    const buf_94 = createTexture(gl, 40.0, getTensorBuffer(safetensor, metadata['_blocks.3._bn2.weight']));
    const buf_95 = createTexture(gl, 40.0, getTensorBuffer(safetensor, metadata['_blocks.3._bn2.running_var']));
    const buf_96 = createTexture(gl, 40.0, getTensorBuffer(safetensor, metadata['_blocks.3._bn2.bias']));
    const buf_97 = createTexture(gl, 188160.0);;
    const buf_98 = createTexture(gl, 9600.0, getTensorBuffer(safetensor, metadata['_blocks.4._expand_conv']));
    const buf_99 = createTexture(gl, 240.0, getTensorBuffer(safetensor, metadata['_blocks.4._bn0.running_mean']));
    const buf_100 = createTexture(gl, 240.0, getTensorBuffer(safetensor, metadata['_blocks.4._bn0.weight']));
    const buf_101 = createTexture(gl, 240.0, getTensorBuffer(safetensor, metadata['_blocks.4._bn0.running_var']));
    const buf_102 = createTexture(gl, 240.0, getTensorBuffer(safetensor, metadata['_blocks.4._bn0.bias']));
    const buf_103 = createTexture(gl, 188160.0);;
    const buf_104 = createTexture(gl, 6000.0, getTensorBuffer(safetensor, metadata['_blocks.4._depthwise_conv']));
    const buf_105 = createTexture(gl, 240.0);;
    const buf_106 = createTexture(gl, 240.0, getTensorBuffer(safetensor, metadata['_blocks.4._bn1.running_mean']));
    const buf_107 = createTexture(gl, 240.0, getTensorBuffer(safetensor, metadata['_blocks.4._bn1.weight']));
    const buf_108 = createTexture(gl, 240.0, getTensorBuffer(safetensor, metadata['_blocks.4._bn1.running_var']));
    const buf_109 = createTexture(gl, 240.0, getTensorBuffer(safetensor, metadata['_blocks.4._bn1.bias']));
    const buf_110 = createTexture(gl, 10.0);;
    const buf_111 = createTexture(gl, 2400.0, getTensorBuffer(safetensor, metadata['_blocks.4._se_reduce']));
    const buf_112 = createTexture(gl, 10.0, getTensorBuffer(safetensor, metadata['_blocks.4._se_reduce_bias']));
    const buf_113 = createTexture(gl, 2400.0, getTensorBuffer(safetensor, metadata['_blocks.4._se_expand']));
    const buf_114 = createTexture(gl, 240.0, getTensorBuffer(safetensor, metadata['_blocks.4._se_expand_bias']));
    const buf_115 = createTexture(gl, 188160.0);;
    const buf_116 = createTexture(gl, 31360.0);;
    const buf_117 = createTexture(gl, 9600.0, getTensorBuffer(safetensor, metadata['_blocks.4._project_conv']));
    const buf_118 = createTexture(gl, 40.0, getTensorBuffer(safetensor, metadata['_blocks.4._bn2.running_mean']));
    const buf_119 = createTexture(gl, 40.0, getTensorBuffer(safetensor, metadata['_blocks.4._bn2.weight']));
    const buf_120 = createTexture(gl, 40.0, getTensorBuffer(safetensor, metadata['_blocks.4._bn2.running_var']));
    const buf_121 = createTexture(gl, 40.0, getTensorBuffer(safetensor, metadata['_blocks.4._bn2.bias']));
    const buf_122 = createTexture(gl, 9600.0, getTensorBuffer(safetensor, metadata['_blocks.5._expand_conv']));
    const buf_123 = createTexture(gl, 240.0, getTensorBuffer(safetensor, metadata['_blocks.5._bn0.running_mean']));
    const buf_124 = createTexture(gl, 240.0, getTensorBuffer(safetensor, metadata['_blocks.5._bn0.weight']));
    const buf_125 = createTexture(gl, 240.0, getTensorBuffer(safetensor, metadata['_blocks.5._bn0.running_var']));
    const buf_126 = createTexture(gl, 240.0, getTensorBuffer(safetensor, metadata['_blocks.5._bn0.bias']));
    const buf_127 = createTexture(gl, 47040.0);;
    const buf_128 = createTexture(gl, 2160.0, getTensorBuffer(safetensor, metadata['_blocks.5._depthwise_conv']));
    const buf_129 = createTexture(gl, 240.0, getTensorBuffer(safetensor, metadata['_blocks.5._bn1.running_mean']));
    const buf_130 = createTexture(gl, 240.0, getTensorBuffer(safetensor, metadata['_blocks.5._bn1.weight']));
    const buf_131 = createTexture(gl, 240.0, getTensorBuffer(safetensor, metadata['_blocks.5._bn1.running_var']));
    const buf_132 = createTexture(gl, 240.0, getTensorBuffer(safetensor, metadata['_blocks.5._bn1.bias']));
    const buf_133 = createTexture(gl, 2400.0, getTensorBuffer(safetensor, metadata['_blocks.5._se_reduce']));
    const buf_134 = createTexture(gl, 10.0, getTensorBuffer(safetensor, metadata['_blocks.5._se_reduce_bias']));
    const buf_135 = createTexture(gl, 2400.0, getTensorBuffer(safetensor, metadata['_blocks.5._se_expand']));
    const buf_136 = createTexture(gl, 240.0, getTensorBuffer(safetensor, metadata['_blocks.5._se_expand_bias']));
    const buf_137 = createTexture(gl, 47040.0);;
    const buf_138 = createTexture(gl, 15680.0);;
    const buf_139 = createTexture(gl, 19200.0, getTensorBuffer(safetensor, metadata['_blocks.5._project_conv']));
    const buf_140 = createTexture(gl, 80.0, getTensorBuffer(safetensor, metadata['_blocks.5._bn2.running_mean']));
    const buf_141 = createTexture(gl, 80.0, getTensorBuffer(safetensor, metadata['_blocks.5._bn2.weight']));
    const buf_142 = createTexture(gl, 80.0, getTensorBuffer(safetensor, metadata['_blocks.5._bn2.running_var']));
    const buf_143 = createTexture(gl, 80.0, getTensorBuffer(safetensor, metadata['_blocks.5._bn2.bias']));
    const buf_144 = createTexture(gl, 94080.0);;
    const buf_145 = createTexture(gl, 38400.0, getTensorBuffer(safetensor, metadata['_blocks.6._expand_conv']));
    const buf_146 = createTexture(gl, 480.0, getTensorBuffer(safetensor, metadata['_blocks.6._bn0.running_mean']));
    const buf_147 = createTexture(gl, 480.0, getTensorBuffer(safetensor, metadata['_blocks.6._bn0.weight']));
    const buf_148 = createTexture(gl, 480.0, getTensorBuffer(safetensor, metadata['_blocks.6._bn0.running_var']));
    const buf_149 = createTexture(gl, 480.0, getTensorBuffer(safetensor, metadata['_blocks.6._bn0.bias']));
    const buf_150 = createTexture(gl, 94080.0);;
    const buf_151 = createTexture(gl, 4320.0, getTensorBuffer(safetensor, metadata['_blocks.6._depthwise_conv']));
    const buf_152 = createTexture(gl, 480.0);;
    const buf_153 = createTexture(gl, 480.0, getTensorBuffer(safetensor, metadata['_blocks.6._bn1.running_mean']));
    const buf_154 = createTexture(gl, 480.0, getTensorBuffer(safetensor, metadata['_blocks.6._bn1.weight']));
    const buf_155 = createTexture(gl, 480.0, getTensorBuffer(safetensor, metadata['_blocks.6._bn1.running_var']));
    const buf_156 = createTexture(gl, 480.0, getTensorBuffer(safetensor, metadata['_blocks.6._bn1.bias']));
    const buf_157 = createTexture(gl, 20.0);;
    const buf_158 = createTexture(gl, 9600.0, getTensorBuffer(safetensor, metadata['_blocks.6._se_reduce']));
    const buf_159 = createTexture(gl, 20.0, getTensorBuffer(safetensor, metadata['_blocks.6._se_reduce_bias']));
    const buf_160 = createTexture(gl, 9600.0, getTensorBuffer(safetensor, metadata['_blocks.6._se_expand']));
    const buf_161 = createTexture(gl, 480.0, getTensorBuffer(safetensor, metadata['_blocks.6._se_expand_bias']));
    const buf_162 = createTexture(gl, 94080.0);;
    const buf_163 = createTexture(gl, 15680.0);;
    const buf_164 = createTexture(gl, 38400.0, getTensorBuffer(safetensor, metadata['_blocks.6._project_conv']));
    const buf_165 = createTexture(gl, 80.0, getTensorBuffer(safetensor, metadata['_blocks.6._bn2.running_mean']));
    const buf_166 = createTexture(gl, 80.0, getTensorBuffer(safetensor, metadata['_blocks.6._bn2.weight']));
    const buf_167 = createTexture(gl, 80.0, getTensorBuffer(safetensor, metadata['_blocks.6._bn2.running_var']));
    const buf_168 = createTexture(gl, 80.0, getTensorBuffer(safetensor, metadata['_blocks.6._bn2.bias']));
    const buf_169 = createTexture(gl, 38400.0, getTensorBuffer(safetensor, metadata['_blocks.7._expand_conv']));
    const buf_170 = createTexture(gl, 480.0, getTensorBuffer(safetensor, metadata['_blocks.7._bn0.running_mean']));
    const buf_171 = createTexture(gl, 480.0, getTensorBuffer(safetensor, metadata['_blocks.7._bn0.weight']));
    const buf_172 = createTexture(gl, 480.0, getTensorBuffer(safetensor, metadata['_blocks.7._bn0.running_var']));
    const buf_173 = createTexture(gl, 480.0, getTensorBuffer(safetensor, metadata['_blocks.7._bn0.bias']));
    const buf_174 = createTexture(gl, 4320.0, getTensorBuffer(safetensor, metadata['_blocks.7._depthwise_conv']));
    const buf_175 = createTexture(gl, 480.0, getTensorBuffer(safetensor, metadata['_blocks.7._bn1.running_mean']));
    const buf_176 = createTexture(gl, 480.0, getTensorBuffer(safetensor, metadata['_blocks.7._bn1.weight']));
    const buf_177 = createTexture(gl, 480.0, getTensorBuffer(safetensor, metadata['_blocks.7._bn1.running_var']));
    const buf_178 = createTexture(gl, 480.0, getTensorBuffer(safetensor, metadata['_blocks.7._bn1.bias']));
    const buf_179 = createTexture(gl, 9600.0, getTensorBuffer(safetensor, metadata['_blocks.7._se_reduce']));
    const buf_180 = createTexture(gl, 20.0, getTensorBuffer(safetensor, metadata['_blocks.7._se_reduce_bias']));
    const buf_181 = createTexture(gl, 9600.0, getTensorBuffer(safetensor, metadata['_blocks.7._se_expand']));
    const buf_182 = createTexture(gl, 480.0, getTensorBuffer(safetensor, metadata['_blocks.7._se_expand_bias']));
    const buf_183 = createTexture(gl, 38400.0, getTensorBuffer(safetensor, metadata['_blocks.7._project_conv']));
    const buf_184 = createTexture(gl, 80.0, getTensorBuffer(safetensor, metadata['_blocks.7._bn2.running_mean']));
    const buf_185 = createTexture(gl, 80.0, getTensorBuffer(safetensor, metadata['_blocks.7._bn2.weight']));
    const buf_186 = createTexture(gl, 80.0, getTensorBuffer(safetensor, metadata['_blocks.7._bn2.running_var']));
    const buf_187 = createTexture(gl, 80.0, getTensorBuffer(safetensor, metadata['_blocks.7._bn2.bias']));
    const buf_188 = createTexture(gl, 38400.0, getTensorBuffer(safetensor, metadata['_blocks.8._expand_conv']));
    const buf_189 = createTexture(gl, 480.0, getTensorBuffer(safetensor, metadata['_blocks.8._bn0.running_mean']));
    const buf_190 = createTexture(gl, 480.0, getTensorBuffer(safetensor, metadata['_blocks.8._bn0.weight']));
    const buf_191 = createTexture(gl, 480.0, getTensorBuffer(safetensor, metadata['_blocks.8._bn0.running_var']));
    const buf_192 = createTexture(gl, 480.0, getTensorBuffer(safetensor, metadata['_blocks.8._bn0.bias']));
    const buf_193 = createTexture(gl, 12000.0, getTensorBuffer(safetensor, metadata['_blocks.8._depthwise_conv']));
    const buf_194 = createTexture(gl, 480.0, getTensorBuffer(safetensor, metadata['_blocks.8._bn1.running_mean']));
    const buf_195 = createTexture(gl, 480.0, getTensorBuffer(safetensor, metadata['_blocks.8._bn1.weight']));
    const buf_196 = createTexture(gl, 480.0, getTensorBuffer(safetensor, metadata['_blocks.8._bn1.running_var']));
    const buf_197 = createTexture(gl, 480.0, getTensorBuffer(safetensor, metadata['_blocks.8._bn1.bias']));
    const buf_198 = createTexture(gl, 9600.0, getTensorBuffer(safetensor, metadata['_blocks.8._se_reduce']));
    const buf_199 = createTexture(gl, 20.0, getTensorBuffer(safetensor, metadata['_blocks.8._se_reduce_bias']));
    const buf_200 = createTexture(gl, 9600.0, getTensorBuffer(safetensor, metadata['_blocks.8._se_expand']));
    const buf_201 = createTexture(gl, 480.0, getTensorBuffer(safetensor, metadata['_blocks.8._se_expand_bias']));
    const buf_202 = createTexture(gl, 21952.0);;
    const buf_203 = createTexture(gl, 53760.0, getTensorBuffer(safetensor, metadata['_blocks.8._project_conv']));
    const buf_204 = createTexture(gl, 112.0, getTensorBuffer(safetensor, metadata['_blocks.8._bn2.running_mean']));
    const buf_205 = createTexture(gl, 112.0, getTensorBuffer(safetensor, metadata['_blocks.8._bn2.weight']));
    const buf_206 = createTexture(gl, 112.0, getTensorBuffer(safetensor, metadata['_blocks.8._bn2.running_var']));
    const buf_207 = createTexture(gl, 112.0, getTensorBuffer(safetensor, metadata['_blocks.8._bn2.bias']));
    const buf_208 = createTexture(gl, 131712.0);;
    const buf_209 = createTexture(gl, 75264.0, getTensorBuffer(safetensor, metadata['_blocks.9._expand_conv']));
    const buf_210 = createTexture(gl, 672.0, getTensorBuffer(safetensor, metadata['_blocks.9._bn0.running_mean']));
    const buf_211 = createTexture(gl, 672.0, getTensorBuffer(safetensor, metadata['_blocks.9._bn0.weight']));
    const buf_212 = createTexture(gl, 672.0, getTensorBuffer(safetensor, metadata['_blocks.9._bn0.running_var']));
    const buf_213 = createTexture(gl, 672.0, getTensorBuffer(safetensor, metadata['_blocks.9._bn0.bias']));
    const buf_214 = createTexture(gl, 131712.0);;
    const buf_215 = createTexture(gl, 16800.0, getTensorBuffer(safetensor, metadata['_blocks.9._depthwise_conv']));
    const buf_216 = createTexture(gl, 672.0);;
    const buf_217 = createTexture(gl, 672.0, getTensorBuffer(safetensor, metadata['_blocks.9._bn1.running_mean']));
    const buf_218 = createTexture(gl, 672.0, getTensorBuffer(safetensor, metadata['_blocks.9._bn1.weight']));
    const buf_219 = createTexture(gl, 672.0, getTensorBuffer(safetensor, metadata['_blocks.9._bn1.running_var']));
    const buf_220 = createTexture(gl, 672.0, getTensorBuffer(safetensor, metadata['_blocks.9._bn1.bias']));
    const buf_221 = createTexture(gl, 28.0);;
    const buf_222 = createTexture(gl, 18816.0, getTensorBuffer(safetensor, metadata['_blocks.9._se_reduce']));
    const buf_223 = createTexture(gl, 28.0, getTensorBuffer(safetensor, metadata['_blocks.9._se_reduce_bias']));
    const buf_224 = createTexture(gl, 18816.0, getTensorBuffer(safetensor, metadata['_blocks.9._se_expand']));
    const buf_225 = createTexture(gl, 672.0, getTensorBuffer(safetensor, metadata['_blocks.9._se_expand_bias']));
    const buf_226 = createTexture(gl, 131712.0);;
    const buf_227 = createTexture(gl, 21952.0);;
    const buf_228 = createTexture(gl, 75264.0, getTensorBuffer(safetensor, metadata['_blocks.9._project_conv']));
    const buf_229 = createTexture(gl, 112.0, getTensorBuffer(safetensor, metadata['_blocks.9._bn2.running_mean']));
    const buf_230 = createTexture(gl, 112.0, getTensorBuffer(safetensor, metadata['_blocks.9._bn2.weight']));
    const buf_231 = createTexture(gl, 112.0, getTensorBuffer(safetensor, metadata['_blocks.9._bn2.running_var']));
    const buf_232 = createTexture(gl, 112.0, getTensorBuffer(safetensor, metadata['_blocks.9._bn2.bias']));
    const buf_233 = createTexture(gl, 75264.0, getTensorBuffer(safetensor, metadata['_blocks.10._expand_conv']));
    const buf_234 = createTexture(gl, 672.0, getTensorBuffer(safetensor, metadata['_blocks.10._bn0.running_mean']));
    const buf_235 = createTexture(gl, 672.0, getTensorBuffer(safetensor, metadata['_blocks.10._bn0.weight']));
    const buf_236 = createTexture(gl, 672.0, getTensorBuffer(safetensor, metadata['_blocks.10._bn0.running_var']));
    const buf_237 = createTexture(gl, 672.0, getTensorBuffer(safetensor, metadata['_blocks.10._bn0.bias']));
    const buf_238 = createTexture(gl, 16800.0, getTensorBuffer(safetensor, metadata['_blocks.10._depthwise_conv']));
    const buf_239 = createTexture(gl, 672.0, getTensorBuffer(safetensor, metadata['_blocks.10._bn1.running_mean']));
    const buf_240 = createTexture(gl, 672.0, getTensorBuffer(safetensor, metadata['_blocks.10._bn1.weight']));
    const buf_241 = createTexture(gl, 672.0, getTensorBuffer(safetensor, metadata['_blocks.10._bn1.running_var']));
    const buf_242 = createTexture(gl, 672.0, getTensorBuffer(safetensor, metadata['_blocks.10._bn1.bias']));
    const buf_243 = createTexture(gl, 18816.0, getTensorBuffer(safetensor, metadata['_blocks.10._se_reduce']));
    const buf_244 = createTexture(gl, 28.0, getTensorBuffer(safetensor, metadata['_blocks.10._se_reduce_bias']));
    const buf_245 = createTexture(gl, 18816.0, getTensorBuffer(safetensor, metadata['_blocks.10._se_expand']));
    const buf_246 = createTexture(gl, 672.0, getTensorBuffer(safetensor, metadata['_blocks.10._se_expand_bias']));
    const buf_247 = createTexture(gl, 75264.0, getTensorBuffer(safetensor, metadata['_blocks.10._project_conv']));
    const buf_248 = createTexture(gl, 112.0, getTensorBuffer(safetensor, metadata['_blocks.10._bn2.running_mean']));
    const buf_249 = createTexture(gl, 112.0, getTensorBuffer(safetensor, metadata['_blocks.10._bn2.weight']));
    const buf_250 = createTexture(gl, 112.0, getTensorBuffer(safetensor, metadata['_blocks.10._bn2.running_var']));
    const buf_251 = createTexture(gl, 112.0, getTensorBuffer(safetensor, metadata['_blocks.10._bn2.bias']));
    const buf_252 = createTexture(gl, 75264.0, getTensorBuffer(safetensor, metadata['_blocks.11._expand_conv']));
    const buf_253 = createTexture(gl, 672.0, getTensorBuffer(safetensor, metadata['_blocks.11._bn0.running_mean']));
    const buf_254 = createTexture(gl, 672.0, getTensorBuffer(safetensor, metadata['_blocks.11._bn0.weight']));
    const buf_255 = createTexture(gl, 672.0, getTensorBuffer(safetensor, metadata['_blocks.11._bn0.running_var']));
    const buf_256 = createTexture(gl, 672.0, getTensorBuffer(safetensor, metadata['_blocks.11._bn0.bias']));
    const buf_257 = createTexture(gl, 32928.0);;
    const buf_258 = createTexture(gl, 16800.0, getTensorBuffer(safetensor, metadata['_blocks.11._depthwise_conv']));
    const buf_259 = createTexture(gl, 672.0, getTensorBuffer(safetensor, metadata['_blocks.11._bn1.running_mean']));
    const buf_260 = createTexture(gl, 672.0, getTensorBuffer(safetensor, metadata['_blocks.11._bn1.weight']));
    const buf_261 = createTexture(gl, 672.0, getTensorBuffer(safetensor, metadata['_blocks.11._bn1.running_var']));
    const buf_262 = createTexture(gl, 672.0, getTensorBuffer(safetensor, metadata['_blocks.11._bn1.bias']));
    const buf_263 = createTexture(gl, 18816.0, getTensorBuffer(safetensor, metadata['_blocks.11._se_reduce']));
    const buf_264 = createTexture(gl, 28.0, getTensorBuffer(safetensor, metadata['_blocks.11._se_reduce_bias']));
    const buf_265 = createTexture(gl, 18816.0, getTensorBuffer(safetensor, metadata['_blocks.11._se_expand']));
    const buf_266 = createTexture(gl, 672.0, getTensorBuffer(safetensor, metadata['_blocks.11._se_expand_bias']));
    const buf_267 = createTexture(gl, 32928.0);;
    const buf_268 = createTexture(gl, 9408.0);;
    const buf_269 = createTexture(gl, 129024.0, getTensorBuffer(safetensor, metadata['_blocks.11._project_conv']));
    const buf_270 = createTexture(gl, 192.0, getTensorBuffer(safetensor, metadata['_blocks.11._bn2.running_mean']));
    const buf_271 = createTexture(gl, 192.0, getTensorBuffer(safetensor, metadata['_blocks.11._bn2.weight']));
    const buf_272 = createTexture(gl, 192.0, getTensorBuffer(safetensor, metadata['_blocks.11._bn2.running_var']));
    const buf_273 = createTexture(gl, 192.0, getTensorBuffer(safetensor, metadata['_blocks.11._bn2.bias']));
    const buf_274 = createTexture(gl, 56448.0);;
    const buf_275 = createTexture(gl, 221184.0, getTensorBuffer(safetensor, metadata['_blocks.12._expand_conv']));
    const buf_276 = createTexture(gl, 1152.0, getTensorBuffer(safetensor, metadata['_blocks.12._bn0.running_mean']));
    const buf_277 = createTexture(gl, 1152.0, getTensorBuffer(safetensor, metadata['_blocks.12._bn0.weight']));
    const buf_278 = createTexture(gl, 1152.0, getTensorBuffer(safetensor, metadata['_blocks.12._bn0.running_var']));
    const buf_279 = createTexture(gl, 1152.0, getTensorBuffer(safetensor, metadata['_blocks.12._bn0.bias']));
    const buf_280 = createTexture(gl, 56448.0);;
    const buf_281 = createTexture(gl, 28800.0, getTensorBuffer(safetensor, metadata['_blocks.12._depthwise_conv']));
    const buf_282 = createTexture(gl, 1152.0);;
    const buf_283 = createTexture(gl, 1152.0, getTensorBuffer(safetensor, metadata['_blocks.12._bn1.running_mean']));
    const buf_284 = createTexture(gl, 1152.0, getTensorBuffer(safetensor, metadata['_blocks.12._bn1.weight']));
    const buf_285 = createTexture(gl, 1152.0, getTensorBuffer(safetensor, metadata['_blocks.12._bn1.running_var']));
    const buf_286 = createTexture(gl, 1152.0, getTensorBuffer(safetensor, metadata['_blocks.12._bn1.bias']));
    const buf_287 = createTexture(gl, 48.0);;
    const buf_288 = createTexture(gl, 55296.0, getTensorBuffer(safetensor, metadata['_blocks.12._se_reduce']));
    const buf_289 = createTexture(gl, 48.0, getTensorBuffer(safetensor, metadata['_blocks.12._se_reduce_bias']));
    const buf_290 = createTexture(gl, 55296.0, getTensorBuffer(safetensor, metadata['_blocks.12._se_expand']));
    const buf_291 = createTexture(gl, 1152.0, getTensorBuffer(safetensor, metadata['_blocks.12._se_expand_bias']));
    const buf_292 = createTexture(gl, 56448.0);;
    const buf_293 = createTexture(gl, 9408.0);;
    const buf_294 = createTexture(gl, 221184.0, getTensorBuffer(safetensor, metadata['_blocks.12._project_conv']));
    const buf_295 = createTexture(gl, 192.0, getTensorBuffer(safetensor, metadata['_blocks.12._bn2.running_mean']));
    const buf_296 = createTexture(gl, 192.0, getTensorBuffer(safetensor, metadata['_blocks.12._bn2.weight']));
    const buf_297 = createTexture(gl, 192.0, getTensorBuffer(safetensor, metadata['_blocks.12._bn2.running_var']));
    const buf_298 = createTexture(gl, 192.0, getTensorBuffer(safetensor, metadata['_blocks.12._bn2.bias']));
    const buf_299 = createTexture(gl, 221184.0, getTensorBuffer(safetensor, metadata['_blocks.13._expand_conv']));
    const buf_300 = createTexture(gl, 1152.0, getTensorBuffer(safetensor, metadata['_blocks.13._bn0.running_mean']));
    const buf_301 = createTexture(gl, 1152.0, getTensorBuffer(safetensor, metadata['_blocks.13._bn0.weight']));
    const buf_302 = createTexture(gl, 1152.0, getTensorBuffer(safetensor, metadata['_blocks.13._bn0.running_var']));
    const buf_303 = createTexture(gl, 1152.0, getTensorBuffer(safetensor, metadata['_blocks.13._bn0.bias']));
    const buf_304 = createTexture(gl, 28800.0, getTensorBuffer(safetensor, metadata['_blocks.13._depthwise_conv']));
    const buf_305 = createTexture(gl, 1152.0, getTensorBuffer(safetensor, metadata['_blocks.13._bn1.running_mean']));
    const buf_306 = createTexture(gl, 1152.0, getTensorBuffer(safetensor, metadata['_blocks.13._bn1.weight']));
    const buf_307 = createTexture(gl, 1152.0, getTensorBuffer(safetensor, metadata['_blocks.13._bn1.running_var']));
    const buf_308 = createTexture(gl, 1152.0, getTensorBuffer(safetensor, metadata['_blocks.13._bn1.bias']));
    const buf_309 = createTexture(gl, 55296.0, getTensorBuffer(safetensor, metadata['_blocks.13._se_reduce']));
    const buf_310 = createTexture(gl, 48.0, getTensorBuffer(safetensor, metadata['_blocks.13._se_reduce_bias']));
    const buf_311 = createTexture(gl, 55296.0, getTensorBuffer(safetensor, metadata['_blocks.13._se_expand']));
    const buf_312 = createTexture(gl, 1152.0, getTensorBuffer(safetensor, metadata['_blocks.13._se_expand_bias']));
    const buf_313 = createTexture(gl, 221184.0, getTensorBuffer(safetensor, metadata['_blocks.13._project_conv']));
    const buf_314 = createTexture(gl, 192.0, getTensorBuffer(safetensor, metadata['_blocks.13._bn2.running_mean']));
    const buf_315 = createTexture(gl, 192.0, getTensorBuffer(safetensor, metadata['_blocks.13._bn2.weight']));
    const buf_316 = createTexture(gl, 192.0, getTensorBuffer(safetensor, metadata['_blocks.13._bn2.running_var']));
    const buf_317 = createTexture(gl, 192.0, getTensorBuffer(safetensor, metadata['_blocks.13._bn2.bias']));
    const buf_318 = createTexture(gl, 221184.0, getTensorBuffer(safetensor, metadata['_blocks.14._expand_conv']));
    const buf_319 = createTexture(gl, 1152.0, getTensorBuffer(safetensor, metadata['_blocks.14._bn0.running_mean']));
    const buf_320 = createTexture(gl, 1152.0, getTensorBuffer(safetensor, metadata['_blocks.14._bn0.weight']));
    const buf_321 = createTexture(gl, 1152.0, getTensorBuffer(safetensor, metadata['_blocks.14._bn0.running_var']));
    const buf_322 = createTexture(gl, 1152.0, getTensorBuffer(safetensor, metadata['_blocks.14._bn0.bias']));
    const buf_323 = createTexture(gl, 28800.0, getTensorBuffer(safetensor, metadata['_blocks.14._depthwise_conv']));
    const buf_324 = createTexture(gl, 1152.0, getTensorBuffer(safetensor, metadata['_blocks.14._bn1.running_mean']));
    const buf_325 = createTexture(gl, 1152.0, getTensorBuffer(safetensor, metadata['_blocks.14._bn1.weight']));
    const buf_326 = createTexture(gl, 1152.0, getTensorBuffer(safetensor, metadata['_blocks.14._bn1.running_var']));
    const buf_327 = createTexture(gl, 1152.0, getTensorBuffer(safetensor, metadata['_blocks.14._bn1.bias']));
    const buf_328 = createTexture(gl, 55296.0, getTensorBuffer(safetensor, metadata['_blocks.14._se_reduce']));
    const buf_329 = createTexture(gl, 48.0, getTensorBuffer(safetensor, metadata['_blocks.14._se_reduce_bias']));
    const buf_330 = createTexture(gl, 55296.0, getTensorBuffer(safetensor, metadata['_blocks.14._se_expand']));
    const buf_331 = createTexture(gl, 1152.0, getTensorBuffer(safetensor, metadata['_blocks.14._se_expand_bias']));
    const buf_332 = createTexture(gl, 221184.0, getTensorBuffer(safetensor, metadata['_blocks.14._project_conv']));
    const buf_333 = createTexture(gl, 192.0, getTensorBuffer(safetensor, metadata['_blocks.14._bn2.running_mean']));
    const buf_334 = createTexture(gl, 192.0, getTensorBuffer(safetensor, metadata['_blocks.14._bn2.weight']));
    const buf_335 = createTexture(gl, 192.0, getTensorBuffer(safetensor, metadata['_blocks.14._bn2.running_var']));
    const buf_336 = createTexture(gl, 192.0, getTensorBuffer(safetensor, metadata['_blocks.14._bn2.bias']));
    const buf_337 = createTexture(gl, 221184.0, getTensorBuffer(safetensor, metadata['_blocks.15._expand_conv']));
    const buf_338 = createTexture(gl, 1152.0, getTensorBuffer(safetensor, metadata['_blocks.15._bn0.running_mean']));
    const buf_339 = createTexture(gl, 1152.0, getTensorBuffer(safetensor, metadata['_blocks.15._bn0.weight']));
    const buf_340 = createTexture(gl, 1152.0, getTensorBuffer(safetensor, metadata['_blocks.15._bn0.running_var']));
    const buf_341 = createTexture(gl, 1152.0, getTensorBuffer(safetensor, metadata['_blocks.15._bn0.bias']));
    const buf_342 = createTexture(gl, 10368.0, getTensorBuffer(safetensor, metadata['_blocks.15._depthwise_conv']));
    const buf_343 = createTexture(gl, 1152.0, getTensorBuffer(safetensor, metadata['_blocks.15._bn1.running_mean']));
    const buf_344 = createTexture(gl, 1152.0, getTensorBuffer(safetensor, metadata['_blocks.15._bn1.weight']));
    const buf_345 = createTexture(gl, 1152.0, getTensorBuffer(safetensor, metadata['_blocks.15._bn1.running_var']));
    const buf_346 = createTexture(gl, 1152.0, getTensorBuffer(safetensor, metadata['_blocks.15._bn1.bias']));
    const buf_347 = createTexture(gl, 55296.0, getTensorBuffer(safetensor, metadata['_blocks.15._se_reduce']));
    const buf_348 = createTexture(gl, 48.0, getTensorBuffer(safetensor, metadata['_blocks.15._se_reduce_bias']));
    const buf_349 = createTexture(gl, 55296.0, getTensorBuffer(safetensor, metadata['_blocks.15._se_expand']));
    const buf_350 = createTexture(gl, 1152.0, getTensorBuffer(safetensor, metadata['_blocks.15._se_expand_bias']));
    const buf_351 = createTexture(gl, 368640.0, getTensorBuffer(safetensor, metadata['_blocks.15._project_conv']));
    const buf_352 = createTexture(gl, 320.0, getTensorBuffer(safetensor, metadata['_blocks.15._bn2.running_mean']));
    const buf_353 = createTexture(gl, 320.0, getTensorBuffer(safetensor, metadata['_blocks.15._bn2.weight']));
    const buf_354 = createTexture(gl, 320.0, getTensorBuffer(safetensor, metadata['_blocks.15._bn2.running_var']));
    const buf_355 = createTexture(gl, 320.0, getTensorBuffer(safetensor, metadata['_blocks.15._bn2.bias']));
    const buf_356 = createTexture(gl, 62720.0);;
    const buf_357 = createTexture(gl, 409600.0, getTensorBuffer(safetensor, metadata['_conv_head']));
    const buf_358 = createTexture(gl, 1280.0);;
    const buf_359 = createTexture(gl, 1280.0, getTensorBuffer(safetensor, metadata['_bn1.running_mean']));
    const buf_360 = createTexture(gl, 1280.0, getTensorBuffer(safetensor, metadata['_bn1.weight']));
    const buf_361 = createTexture(gl, 1280.0, getTensorBuffer(safetensor, metadata['_bn1.running_var']));
    const buf_362 = createTexture(gl, 1280.0, getTensorBuffer(safetensor, metadata['_bn1.bias']));
    const output0 = createTexture(gl, 1000.0);;
    const buf_363 = createTexture(gl, 1280000.0, getTensorBuffer(safetensor, metadata['_fc']));
    const buf_364 = createTexture(gl, 1000.0, getTensorBuffer(safetensor, metadata['_fc_bias']));
let programs = [r_32_112_112_3_3_3, r_32_112_112_3_3, r_32_12544, r_8_32, r_32_8, r_32_112_112_3_3n1, r_16_12544_32, r_96_12544_16, r_96_56_56_3_3, r_96_3136, r_4_96, r_96_4, r_96_56_56_3_3n1, r_24_3136_96, r_144_3136_24, r_144_56_56_3_3, r_144_3136, r_6_144, r_144_6, r_144_56_56_3_3n1, r_24_3136_144, r_144_3136_24, r_144_28_28_5_5, r_144_784, r_6_144, r_144_6, r_144_28_28_5_5n1, r_40_784_144, r_240_784_40, r_240_28_28_5_5, r_240_784, r_10_240, r_240_10, r_240_28_28_5_5n1, r_40_784_240, r_240_784_40, r_240_14_14_3_3, r_240_196, r_10_240, r_240_10, r_240_14_14_3_3n1, r_80_196_240, r_480_196_80, r_480_14_14_3_3, r_480_196, r_20_480, r_480_20, r_480_14_14_3_3n1, r_80_196_480, r_480_196_80, r_480_14_14_3_3, r_480_196, r_20_480, r_480_20, r_480_14_14_3_3n1, r_80_196_480, r_480_196_80, r_480_14_14_5_5, r_480_196, r_20_480, r_480_20, r_480_14_14_5_5n1, r_112_196_480, r_672_196_112, r_672_14_14_5_5, r_672_196, r_28_672, r_672_28, r_672_14_14_5_5n1, r_112_196_672, r_672_196_112, r_672_14_14_5_5, r_672_196, r_28_672, r_672_28, r_672_14_14_5_5n1, r_112_196_672, r_672_196_112, r_672_7_7_5_5, r_672_49, r_28_672, r_672_28, r_672_7_7_5_5n1, r_192_49_672, r_1152_49_192, r_1152_7_7_5_5, r_1152_49, r_48_1152, r_1152_48, r_1152_7_7_5_5n1, r_192_49_1152, r_1152_49_192, r_1152_7_7_5_5, r_1152_49, r_48_1152, r_1152_48, r_1152_7_7_5_5n1, r_192_49_1152, r_1152_49_192, r_1152_7_7_5_5, r_1152_49, r_48_1152, r_1152_48, r_1152_7_7_5_5n1, r_192_49_1152, r_1152_49_192, r_1152_7_7_3_3, r_1152_49, r_48_1152, r_1152_48, r_1152_7_7_3_3n1, r_320_49_1152, r_1280_49_320, r_1280_49, r_1000_1280].map((code) => createShaderProgram(gl, code));

    return function(_input0) {
      const ext = gl.getExtension('EXT_color_buffer_float');
      updateTextureData(gl, input0, _input0);
      runProgram(gl, 'r_32_112_112_3_3_3', programs[0], [buf_0, input0, buf_1, buf_2, buf_3, buf_4, buf_5]);
        runProgram(gl, 'r_32_112_112_3_3', programs[1], [buf_6, buf_0, buf_7]);
        runProgram(gl, 'r_32_12544', programs[2], [buf_8, buf_6, buf_9, buf_10, buf_11, buf_12]);
        runProgram(gl, 'r_8_32', programs[3], [buf_13, buf_8, buf_14, buf_15]);
        runProgram(gl, 'r_32_8', programs[4], [buf_8, buf_13, buf_16, buf_17]);
        runProgram(gl, 'r_32_112_112_3_3n1', programs[5], [buf_18, buf_0, buf_7, buf_9, buf_10, buf_11, buf_12, buf_8]);
        runProgram(gl, 'r_16_12544_32', programs[6], [buf_19, buf_18, buf_20, buf_21, buf_22, buf_23, buf_24]);
        runProgram(gl, 'r_96_12544_16', programs[7], [buf_25, buf_19, buf_26, buf_27, buf_28, buf_29, buf_30]);
        runProgram(gl, 'r_96_56_56_3_3', programs[8], [buf_31, buf_25, buf_32]);
        runProgram(gl, 'r_96_3136', programs[9], [buf_33, buf_31, buf_34, buf_35, buf_36, buf_37]);
        runProgram(gl, 'r_4_96', programs[10], [buf_38, buf_33, buf_39, buf_40]);
        runProgram(gl, 'r_96_4', programs[11], [buf_33, buf_38, buf_41, buf_42]);
        runProgram(gl, 'r_96_56_56_3_3n1', programs[12], [buf_43, buf_25, buf_32, buf_34, buf_35, buf_36, buf_37, buf_33]);
        runProgram(gl, 'r_24_3136_96', programs[13], [buf_44, buf_43, buf_45, buf_46, buf_47, buf_48, buf_49]);
        runProgram(gl, 'r_144_3136_24', programs[14], [buf_50, buf_44, buf_51, buf_52, buf_53, buf_54, buf_55]);
        runProgram(gl, 'r_144_56_56_3_3', programs[15], [buf_56, buf_50, buf_57]);
        runProgram(gl, 'r_144_3136', programs[16], [buf_58, buf_56, buf_59, buf_60, buf_61, buf_62]);
        runProgram(gl, 'r_6_144', programs[17], [buf_63, buf_58, buf_64, buf_65]);
        runProgram(gl, 'r_144_6', programs[18], [buf_58, buf_63, buf_66, buf_67]);
        runProgram(gl, 'r_144_56_56_3_3n1', programs[19], [buf_68, buf_50, buf_57, buf_59, buf_60, buf_61, buf_62, buf_58]);
        runProgram(gl, 'r_24_3136_144', programs[20], [buf_69, buf_68, buf_70, buf_71, buf_72, buf_73, buf_74, buf_44]);
        runProgram(gl, 'r_144_3136_24', programs[21], [buf_68, buf_69, buf_75, buf_76, buf_77, buf_78, buf_79]);
        runProgram(gl, 'r_144_28_28_5_5', programs[22], [buf_80, buf_68, buf_81]);
        runProgram(gl, 'r_144_784', programs[23], [buf_58, buf_80, buf_82, buf_83, buf_84, buf_85]);
        runProgram(gl, 'r_6_144', programs[24], [buf_63, buf_58, buf_86, buf_87]);
        runProgram(gl, 'r_144_6', programs[25], [buf_58, buf_63, buf_88, buf_89]);
        runProgram(gl, 'r_144_28_28_5_5n1', programs[26], [buf_90, buf_68, buf_81, buf_82, buf_83, buf_84, buf_85, buf_58]);
        runProgram(gl, 'r_40_784_144', programs[27], [buf_91, buf_90, buf_92, buf_93, buf_94, buf_95, buf_96]);
        runProgram(gl, 'r_240_784_40', programs[28], [buf_97, buf_91, buf_98, buf_99, buf_100, buf_101, buf_102]);
        runProgram(gl, 'r_240_28_28_5_5', programs[29], [buf_103, buf_97, buf_104]);
        runProgram(gl, 'r_240_784', programs[30], [buf_105, buf_103, buf_106, buf_107, buf_108, buf_109]);
        runProgram(gl, 'r_10_240', programs[31], [buf_110, buf_105, buf_111, buf_112]);
        runProgram(gl, 'r_240_10', programs[32], [buf_105, buf_110, buf_113, buf_114]);
        runProgram(gl, 'r_240_28_28_5_5n1', programs[33], [buf_115, buf_97, buf_104, buf_106, buf_107, buf_108, buf_109, buf_105]);
        runProgram(gl, 'r_40_784_240', programs[34], [buf_116, buf_115, buf_117, buf_118, buf_119, buf_120, buf_121, buf_91]);
        runProgram(gl, 'r_240_784_40', programs[35], [buf_115, buf_116, buf_122, buf_123, buf_124, buf_125, buf_126]);
        runProgram(gl, 'r_240_14_14_3_3', programs[36], [buf_127, buf_115, buf_128]);
        runProgram(gl, 'r_240_196', programs[37], [buf_105, buf_127, buf_129, buf_130, buf_131, buf_132]);
        runProgram(gl, 'r_10_240', programs[38], [buf_110, buf_105, buf_133, buf_134]);
        runProgram(gl, 'r_240_10', programs[39], [buf_105, buf_110, buf_135, buf_136]);
        runProgram(gl, 'r_240_14_14_3_3n1', programs[40], [buf_137, buf_115, buf_128, buf_129, buf_130, buf_131, buf_132, buf_105]);
        runProgram(gl, 'r_80_196_240', programs[41], [buf_138, buf_137, buf_139, buf_140, buf_141, buf_142, buf_143]);
        runProgram(gl, 'r_480_196_80', programs[42], [buf_144, buf_138, buf_145, buf_146, buf_147, buf_148, buf_149]);
        runProgram(gl, 'r_480_14_14_3_3', programs[43], [buf_150, buf_144, buf_151]);
        runProgram(gl, 'r_480_196', programs[44], [buf_152, buf_150, buf_153, buf_154, buf_155, buf_156]);
        runProgram(gl, 'r_20_480', programs[45], [buf_157, buf_152, buf_158, buf_159]);
        runProgram(gl, 'r_480_20', programs[46], [buf_152, buf_157, buf_160, buf_161]);
        runProgram(gl, 'r_480_14_14_3_3n1', programs[47], [buf_162, buf_144, buf_151, buf_153, buf_154, buf_155, buf_156, buf_152]);
        runProgram(gl, 'r_80_196_480', programs[48], [buf_163, buf_162, buf_164, buf_165, buf_166, buf_167, buf_168, buf_138]);
        runProgram(gl, 'r_480_196_80', programs[49], [buf_162, buf_163, buf_169, buf_170, buf_171, buf_172, buf_173]);
        runProgram(gl, 'r_480_14_14_3_3', programs[50], [buf_144, buf_162, buf_174]);
        runProgram(gl, 'r_480_196', programs[51], [buf_152, buf_144, buf_175, buf_176, buf_177, buf_178]);
        runProgram(gl, 'r_20_480', programs[52], [buf_157, buf_152, buf_179, buf_180]);
        runProgram(gl, 'r_480_20', programs[53], [buf_152, buf_157, buf_181, buf_182]);
        runProgram(gl, 'r_480_14_14_3_3n1', programs[54], [buf_150, buf_162, buf_174, buf_175, buf_176, buf_177, buf_178, buf_152]);
        runProgram(gl, 'r_80_196_480', programs[55], [buf_138, buf_150, buf_183, buf_184, buf_185, buf_186, buf_187, buf_163]);
        runProgram(gl, 'r_480_196_80', programs[56], [buf_150, buf_138, buf_188, buf_189, buf_190, buf_191, buf_192]);
        runProgram(gl, 'r_480_14_14_5_5', programs[57], [buf_162, buf_150, buf_193]);
        runProgram(gl, 'r_480_196', programs[58], [buf_152, buf_162, buf_194, buf_195, buf_196, buf_197]);
        runProgram(gl, 'r_20_480', programs[59], [buf_157, buf_152, buf_198, buf_199]);
        runProgram(gl, 'r_480_20', programs[60], [buf_152, buf_157, buf_200, buf_201]);
        runProgram(gl, 'r_480_14_14_5_5n1', programs[61], [buf_144, buf_150, buf_193, buf_194, buf_195, buf_196, buf_197, buf_152]);
        runProgram(gl, 'r_112_196_480', programs[62], [buf_202, buf_144, buf_203, buf_204, buf_205, buf_206, buf_207]);
        runProgram(gl, 'r_672_196_112', programs[63], [buf_208, buf_202, buf_209, buf_210, buf_211, buf_212, buf_213]);
        runProgram(gl, 'r_672_14_14_5_5', programs[64], [buf_214, buf_208, buf_215]);
        runProgram(gl, 'r_672_196', programs[65], [buf_216, buf_214, buf_217, buf_218, buf_219, buf_220]);
        runProgram(gl, 'r_28_672', programs[66], [buf_221, buf_216, buf_222, buf_223]);
        runProgram(gl, 'r_672_28', programs[67], [buf_216, buf_221, buf_224, buf_225]);
        runProgram(gl, 'r_672_14_14_5_5n1', programs[68], [buf_226, buf_208, buf_215, buf_217, buf_218, buf_219, buf_220, buf_216]);
        runProgram(gl, 'r_112_196_672', programs[69], [buf_227, buf_226, buf_228, buf_229, buf_230, buf_231, buf_232, buf_202]);
        runProgram(gl, 'r_672_196_112', programs[70], [buf_226, buf_227, buf_233, buf_234, buf_235, buf_236, buf_237]);
        runProgram(gl, 'r_672_14_14_5_5', programs[71], [buf_208, buf_226, buf_238]);
        runProgram(gl, 'r_672_196', programs[72], [buf_216, buf_208, buf_239, buf_240, buf_241, buf_242]);
        runProgram(gl, 'r_28_672', programs[73], [buf_221, buf_216, buf_243, buf_244]);
        runProgram(gl, 'r_672_28', programs[74], [buf_216, buf_221, buf_245, buf_246]);
        runProgram(gl, 'r_672_14_14_5_5n1', programs[75], [buf_214, buf_226, buf_238, buf_239, buf_240, buf_241, buf_242, buf_216]);
        runProgram(gl, 'r_112_196_672', programs[76], [buf_202, buf_214, buf_247, buf_248, buf_249, buf_250, buf_251, buf_227]);
        runProgram(gl, 'r_672_196_112', programs[77], [buf_214, buf_202, buf_252, buf_253, buf_254, buf_255, buf_256]);
        runProgram(gl, 'r_672_7_7_5_5', programs[78], [buf_257, buf_214, buf_258]);
        runProgram(gl, 'r_672_49', programs[79], [buf_216, buf_257, buf_259, buf_260, buf_261, buf_262]);
        runProgram(gl, 'r_28_672', programs[80], [buf_221, buf_216, buf_263, buf_264]);
        runProgram(gl, 'r_672_28', programs[81], [buf_216, buf_221, buf_265, buf_266]);
        runProgram(gl, 'r_672_7_7_5_5n1', programs[82], [buf_267, buf_214, buf_258, buf_259, buf_260, buf_261, buf_262, buf_216]);
        runProgram(gl, 'r_192_49_672', programs[83], [buf_268, buf_267, buf_269, buf_270, buf_271, buf_272, buf_273]);
        runProgram(gl, 'r_1152_49_192', programs[84], [buf_274, buf_268, buf_275, buf_276, buf_277, buf_278, buf_279]);
        runProgram(gl, 'r_1152_7_7_5_5', programs[85], [buf_280, buf_274, buf_281]);
        runProgram(gl, 'r_1152_49', programs[86], [buf_282, buf_280, buf_283, buf_284, buf_285, buf_286]);
        runProgram(gl, 'r_48_1152', programs[87], [buf_287, buf_282, buf_288, buf_289]);
        runProgram(gl, 'r_1152_48', programs[88], [buf_282, buf_287, buf_290, buf_291]);
        runProgram(gl, 'r_1152_7_7_5_5n1', programs[89], [buf_292, buf_274, buf_281, buf_283, buf_284, buf_285, buf_286, buf_282]);
        runProgram(gl, 'r_192_49_1152', programs[90], [buf_293, buf_292, buf_294, buf_295, buf_296, buf_297, buf_298, buf_268]);
        runProgram(gl, 'r_1152_49_192', programs[91], [buf_292, buf_293, buf_299, buf_300, buf_301, buf_302, buf_303]);
        runProgram(gl, 'r_1152_7_7_5_5', programs[92], [buf_274, buf_292, buf_304]);
        runProgram(gl, 'r_1152_49', programs[93], [buf_282, buf_274, buf_305, buf_306, buf_307, buf_308]);
        runProgram(gl, 'r_48_1152', programs[94], [buf_287, buf_282, buf_309, buf_310]);
        runProgram(gl, 'r_1152_48', programs[95], [buf_282, buf_287, buf_311, buf_312]);
        runProgram(gl, 'r_1152_7_7_5_5n1', programs[96], [buf_280, buf_292, buf_304, buf_305, buf_306, buf_307, buf_308, buf_282]);
        runProgram(gl, 'r_192_49_1152', programs[97], [buf_268, buf_280, buf_313, buf_314, buf_315, buf_316, buf_317, buf_293]);
        runProgram(gl, 'r_1152_49_192', programs[98], [buf_280, buf_268, buf_318, buf_319, buf_320, buf_321, buf_322]);
        runProgram(gl, 'r_1152_7_7_5_5', programs[99], [buf_292, buf_280, buf_323]);
        runProgram(gl, 'r_1152_49', programs[100], [buf_282, buf_292, buf_324, buf_325, buf_326, buf_327]);
        runProgram(gl, 'r_48_1152', programs[101], [buf_287, buf_282, buf_328, buf_329]);
        runProgram(gl, 'r_1152_48', programs[102], [buf_282, buf_287, buf_330, buf_331]);
        runProgram(gl, 'r_1152_7_7_5_5n1', programs[103], [buf_274, buf_280, buf_323, buf_324, buf_325, buf_326, buf_327, buf_282]);
        runProgram(gl, 'r_192_49_1152', programs[104], [buf_293, buf_274, buf_332, buf_333, buf_334, buf_335, buf_336, buf_268]);
        runProgram(gl, 'r_1152_49_192', programs[105], [buf_274, buf_293, buf_337, buf_338, buf_339, buf_340, buf_341]);
        runProgram(gl, 'r_1152_7_7_3_3', programs[106], [buf_280, buf_274, buf_342]);
        runProgram(gl, 'r_1152_49', programs[107], [buf_282, buf_280, buf_343, buf_344, buf_345, buf_346]);
        runProgram(gl, 'r_48_1152', programs[108], [buf_287, buf_282, buf_347, buf_348]);
        runProgram(gl, 'r_1152_48', programs[109], [buf_282, buf_287, buf_349, buf_350]);
        runProgram(gl, 'r_1152_7_7_3_3n1', programs[110], [buf_292, buf_274, buf_342, buf_343, buf_344, buf_345, buf_346, buf_282]);
        runProgram(gl, 'r_320_49_1152', programs[111], [buf_138, buf_292, buf_351, buf_352, buf_353, buf_354, buf_355]);
        runProgram(gl, 'r_1280_49_320', programs[112], [buf_356, buf_138, buf_357]);
        runProgram(gl, 'r_1280_49', programs[113], [buf_358, buf_356, buf_359, buf_360, buf_361, buf_362]);
        runProgram(gl, 'r_1000_1280', programs[114], [output0, buf_358, buf_363, buf_364]);

      return readTextureData(gl, output0);
    }
  }