/* Copyright 2012 Mozilla Foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {
  assert, FormatError, info, isString, shadow, unreachable, warn
} from '../shared/util';
import { isDict, isName, isStream } from './primitives';

/**
 * Resizes an RGB image with 3 components.
 * @param {TypedArray} src - The source buffer.
 * @param {TypedArray} dest - The destination buffer.
 * @param {Number} w1 - Original width.
 * @param {Number} h1 - Original height.
 * @param {Number} w2 - New width.
 * @param {Number} h2 - New height.
 * @param {Number} alpha01 - Size reserved for the alpha channel.
 */
function resizeRgbImage(src, dest, w1, h1, w2, h2, alpha01) {
  const COMPONENTS = 3;
  alpha01 = alpha01 !== 1 ? 0 : alpha01;
  let xRatio = w1 / w2;
  let yRatio = h1 / h2;
  let newIndex = 0, oldIndex;
  let xScaled = new Uint16Array(w2);
  let w1Scanline = w1 * COMPONENTS;

  for (let i = 0; i < w2; i++) {
    xScaled[i] = Math.floor(i * xRatio) * COMPONENTS;
  }
  for (let i = 0; i < h2; i++) {
    const py = Math.floor(i * yRatio) * w1Scanline;
    for (let j = 0; j < w2; j++) {
      oldIndex = py + xScaled[j];
      dest[newIndex++] = src[oldIndex++];
      dest[newIndex++] = src[oldIndex++];
      dest[newIndex++] = src[oldIndex++];
      newIndex += alpha01;
    }
  }
}

class ColorSpace {
  constructor(name, numComps) {
    if (this.constructor === ColorSpace) {
      unreachable('Cannot initialize ColorSpace.');
    }
    this.name = name;
    this.numComps = numComps;
  }

  /**
   * Converts the color value to the RGB color. The color components are
   * located in the src array starting from the srcOffset. Returns the array
   * of the rgb components, each value ranging from [0,255].
   */
  getRgb(src, srcOffset) {
    let rgb = new Uint8ClampedArray(3);
    this.getRgbItem(src, srcOffset, rgb, 0);
    return rgb;
  }

  /**
   * Converts the color value to the RGB color, similar to the getRgb method.
   * The result placed into the dest array starting from the destOffset.
   */
  getRgbItem(src, srcOffset, dest, destOffset) {
    unreachable('Should not call ColorSpace.getRgbItem');
  }

  /**
   * Converts the specified number of the color values to the RGB colors.
   * The colors are located in the src array starting from the srcOffset.
   * The result is placed into the dest array starting from the destOffset.
   * The src array items shall be in [0,2^bits) range, the dest array items
   * will be in [0,255] range. alpha01 indicates how many alpha components
   * there are in the dest array; it will be either 0 (RGB array) or 1 (RGBA
   * array).
   */
  getRgbBuffer(src, srcOffset, count, dest, destOffset, bits, alpha01) {
    unreachable('Should not call ColorSpace.getRgbBuffer');
  }

  /**
   * Determines the number of bytes required to store the result of the
   * conversion done by the getRgbBuffer method. As in getRgbBuffer,
   * |alpha01| is either 0 (RGB output) or 1 (RGBA output).
   */
  getOutputLength(inputLength, alpha01) {
    unreachable('Should not call ColorSpace.getOutputLength');
  }

  /**
   * Returns true if source data will be equal the result/output data.
   */
  isPassthrough(bits) {
    return false;
  }

  /**
   * Fills in the RGB colors in the destination buffer.  alpha01 indicates
   * how many alpha components there are in the dest array; it will be either
   * 0 (RGB array) or 1 (RGBA array).
   */
  fillRgb(dest, originalWidth, originalHeight, width, height, actualHeight,
          bpc, comps, alpha01) {
    if (typeof PDFJSDev === 'undefined' ||
        PDFJSDev.test('!PRODUCTION || TESTING')) {
      assert(dest instanceof Uint8ClampedArray,
             'ColorSpace.fillRgb: Unsupported "dest" type.');
    }
    let count = originalWidth * originalHeight;
    let rgbBuf = null;
    let numComponentColors = 1 << bpc;
    let needsResizing = originalHeight !== height || originalWidth !== width;

    if (this.isPassthrough(bpc)) {
      rgbBuf = comps;
    } else if (this.numComps === 1 && count > numComponentColors &&
               this.name !== 'DeviceGray' && this.name !== 'DeviceRGB') {
      // Optimization: create a color map when there is just one component and
      // we are converting more colors than the size of the color map. We
      // don't build the map if the colorspace is gray or rgb since those
      // methods are faster than building a map. This mainly offers big speed
      // ups for indexed and alternate colorspaces.
      //
      // TODO it may be worth while to cache the color map. While running
      // testing I never hit a cache so I will leave that out for now (perhaps
      // we are reparsing colorspaces too much?).
      let allColors = bpc <= 8 ? new Uint8Array(numComponentColors) :
                                 new Uint16Array(numComponentColors);
      for (let i = 0; i < numComponentColors; i++) {
        allColors[i] = i;
      }
      let colorMap = new Uint8ClampedArray(numComponentColors * 3);
      this.getRgbBuffer(allColors, 0, numComponentColors, colorMap, 0, bpc,
                        /* alpha01 = */ 0);

      if (!needsResizing) {
        // Fill in the RGB values directly into |dest|.
        let destPos = 0;
        for (let i = 0; i < count; ++i) {
          const key = comps[i] * 3;
          dest[destPos++] = colorMap[key];
          dest[destPos++] = colorMap[key + 1];
          dest[destPos++] = colorMap[key + 2];
          destPos += alpha01;
        }
      } else {
        rgbBuf = new Uint8Array(count * 3);
        let rgbPos = 0;
        for (let i = 0; i < count; ++i) {
          const key = comps[i] * 3;
          rgbBuf[rgbPos++] = colorMap[key];
          rgbBuf[rgbPos++] = colorMap[key + 1];
          rgbBuf[rgbPos++] = colorMap[key + 2];
        }
      }
    } else {
      if (!needsResizing) {
        // Fill in the RGB values directly into |dest|.
        this.getRgbBuffer(comps, 0, width * actualHeight, dest, 0, bpc,
                          alpha01);
      } else {
        rgbBuf = new Uint8ClampedArray(count * 3);
        this.getRgbBuffer(comps, 0, count, rgbBuf, 0, bpc, /* alpha01 = */ 0);
      }
    }

    if (rgbBuf) {
      if (needsResizing) {
        resizeRgbImage(rgbBuf, dest, originalWidth, originalHeight,
                       width, height, alpha01);
      } else {
        let destPos = 0, rgbPos = 0;
        for (let i = 0, ii = width * actualHeight; i < ii; i++) {
          dest[destPos++] = rgbBuf[rgbPos++];
          dest[destPos++] = rgbBuf[rgbPos++];
          dest[destPos++] = rgbBuf[rgbPos++];
          destPos += alpha01;
        }
      }
    }
  }

  /**
   * True if the colorspace has components in the default range of [0, 1].
   * This should be true for all colorspaces except for lab color spaces
   * which are [0,100], [-128, 127], [-128, 127].
   */
  get usesZeroToOneRange() {
    return shadow(this, 'usesZeroToOneRange', true);
  }

  static parse(cs, xref, res, pdfFunctionFactory) {
    let IR = this.parseToIR(cs, xref, res, pdfFunctionFactory);
    return this.fromIR(IR);
  }

  static fromIR(IR) {
    let name = Array.isArray(IR) ? IR[0] : IR;
    let whitePoint, blackPoint, gamma;

    switch (name) {
      case 'DeviceGrayCS':
        return this.singletons.gray;
      case 'DeviceRgbCS':
        return this.singletons.rgb;
      case 'DeviceCmykCS':
        return this.singletons.cmyk;
      case 'CalGrayCS':
        whitePoint = IR[1];
        blackPoint = IR[2];
        gamma = IR[3];
        return new CalGrayCS(whitePoint, blackPoint, gamma);
      case 'CalRGBCS':
        whitePoint = IR[1];
        blackPoint = IR[2];
        gamma = IR[3];
        let matrix = IR[4];
        return new CalRGBCS(whitePoint, blackPoint, gamma, matrix);
      case 'PatternCS':
        let basePatternCS = IR[1];
        if (basePatternCS) {
          basePatternCS = this.fromIR(basePatternCS);
        }
        return new PatternCS(basePatternCS);
      case 'IndexedCS':
        let baseIndexedCS = IR[1];
        let hiVal = IR[2];
        let lookup = IR[3];
        return new IndexedCS(this.fromIR(baseIndexedCS), hiVal, lookup);
      case 'AlternateCS':
        let numComps = IR[1];
        let alt = IR[2];
        let tintFn = IR[3];
        return new AlternateCS(numComps, this.fromIR(alt), tintFn);
      case 'LabCS':
        whitePoint = IR[1];
        blackPoint = IR[2];
        let range = IR[3];
        return new LabCS(whitePoint, blackPoint, range);
      default:
        throw new FormatError(`Unknown colorspace name: ${name}`);
    }
  }

  static parseToIR(cs, xref, res = null, pdfFunctionFactory) {
    cs = xref.fetchIfRef(cs);
    if (isName(cs)) {
      switch (cs.name) {
        case 'DeviceGray':
        case 'G':
          return 'DeviceGrayCS';
        case 'DeviceRGB':
        case 'RGB':
          return 'DeviceRgbCS';
        case 'DeviceCMYK':
        case 'CMYK':
          return 'DeviceCmykCS';
        case 'Pattern':
          return ['PatternCS', null];
        default:
          if (isDict(res)) {
            let colorSpaces = res.get('ColorSpace');
            if (isDict(colorSpaces)) {
              let resCS = colorSpaces.get(cs.name);
              if (resCS) {
                if (isName(resCS)) {
                  return this.parseToIR(resCS, xref, res, pdfFunctionFactory);
                }
                cs = resCS;
                break;
              }
            }
          }
          throw new FormatError(`unrecognized colorspace ${cs.name}`);
      }
    }
    if (Array.isArray(cs)) {
      let mode = xref.fetchIfRef(cs[0]).name;
      let numComps, params, alt, whitePoint, blackPoint, gamma;

      switch (mode) {
        case 'DeviceGray':
        case 'G':
          return 'DeviceGrayCS';
        case 'DeviceRGB':
        case 'RGB':
          return 'DeviceRgbCS';
        case 'DeviceCMYK':
        case 'CMYK':
          return 'DeviceCmykCS';
        case 'CalGray':
          params = xref.fetchIfRef(cs[1]);
          whitePoint = params.getArray('WhitePoint');
          blackPoint = params.getArray('BlackPoint');
          gamma = params.get('Gamma');
          return ['CalGrayCS', whitePoint, blackPoint, gamma];
        case 'CalRGB':
          params = xref.fetchIfRef(cs[1]);
          whitePoint = params.getArray('WhitePoint');
          blackPoint = params.getArray('BlackPoint');
          gamma = params.getArray('Gamma');
          let matrix = params.getArray('Matrix');
          return ['CalRGBCS', whitePoint, blackPoint, gamma, matrix];
        case 'ICCBased':
          let stream = xref.fetchIfRef(cs[1]);
          let dict = stream.dict;
          numComps = dict.get('N');
          alt = dict.get('Alternate');
          if (alt) {
            let altIR = this.parseToIR(alt, xref, res, pdfFunctionFactory);
            // Parse the /Alternate CS to ensure that the number of components
            // are correct, and also (indirectly) that it is not a PatternCS.
            let altCS = this.fromIR(altIR, pdfFunctionFactory);
            if (altCS.numComps === numComps) {
              return altIR;
            }
            warn('ICCBased color space: Ignoring incorrect /Alternate entry.');
          }
          if (numComps === 1) {
            return 'DeviceGrayCS';
          } else if (numComps === 3) {
            return 'DeviceRgbCS';
          } else if (numComps === 4) {
            return 'DeviceCmykCS';
          }
          break;
        case 'Pattern':
          let basePatternCS = cs[1] || null;
          if (basePatternCS) {
            basePatternCS = this.parseToIR(basePatternCS, xref, res,
                                           pdfFunctionFactory);
          }
          return ['PatternCS', basePatternCS];
        case 'Indexed':
        case 'I':
          let baseIndexedCS = this.parseToIR(cs[1], xref, res,
                                             pdfFunctionFactory);
          let hiVal = xref.fetchIfRef(cs[2]) + 1;
          let lookup = xref.fetchIfRef(cs[3]);
          if (isStream(lookup)) {
            lookup = lookup.getBytes();
          }
          return ['IndexedCS', baseIndexedCS, hiVal, lookup];
        case 'Separation':
        case 'DeviceN':
          let name = xref.fetchIfRef(cs[1]);
          numComps = Array.isArray(name) ? name.length : 1;
          alt = this.parseToIR(cs[2], xref, res, pdfFunctionFactory);
          let tintFn = pdfFunctionFactory.create(xref.fetchIfRef(cs[3]));
          return ['AlternateCS', numComps, alt, tintFn];
        case 'Lab':
          params = xref.fetchIfRef(cs[1]);
          whitePoint = params.getArray('WhitePoint');
          blackPoint = params.getArray('BlackPoint');
          let range = params.getArray('Range');
          return ['LabCS', whitePoint, blackPoint, range];
        default:
          throw new FormatError(`unimplemented color space object "${mode}"`);
      }
    }
    throw new FormatError(`unrecognized color space object: "${cs}"`);
  }

  /**
   * Checks if a decode map matches the default decode map for a color space.
   * This handles the general decode maps where there are two values per
   * component. e.g. [0, 1, 0, 1, 0, 1] for a RGB color.
   * This does not handle Lab, Indexed, or Pattern decode maps since they are
   * slightly different.
   * @param {Array} decode Decode map (usually from an image).
   * @param {Number} n Number of components the color space has.
   */
  static isDefaultDecode(decode, n) {
    if (!Array.isArray(decode)) {
      return true;
    }

    if (n * 2 !== decode.length) {
      warn('The decode map is not the correct length');
      return true;
    }
    for (let i = 0, ii = decode.length; i < ii; i += 2) {
      if (decode[i] !== 0 || decode[i + 1] !== 1) {
        return false;
      }
    }
    return true;
  }

  static get singletons() {
    return shadow(this, 'singletons', {
      get gray() {
        return shadow(this, 'gray', new DeviceGrayCS());
      },
      get rgb() {
        return shadow(this, 'rgb', new DeviceRgbCS());
      },
      get cmyk() {
        return shadow(this, 'cmyk', new DeviceCmykCS());
      },
    });
  }
}

/**
 * Alternate color space handles both Separation and DeviceN color spaces.  A
 * Separation color space is actually just a DeviceN with one color component.
 * Both color spaces use a tinting function to convert colors to a base color
 * space.
 *
 * The default color is `new Float32Array(new Array(numComps).fill(1))`.
 */
class AlternateCS extends ColorSpace {
  constructor(numComps, base, tintFn) {
    super('Alternate', numComps);
    this.base = base;
    this.tintFn = tintFn;
    this.tmpBuf = new Float32Array(base.numComps);
  }

  getRgbItem(src, srcOffset, dest, destOffset) {
    if (typeof PDFJSDev === 'undefined' ||
        PDFJSDev.test('!PRODUCTION || TESTING')) {
      assert(dest instanceof Uint8ClampedArray,
             'AlternateCS.getRgbItem: Unsupported "dest" type.');
    }
    let tmpBuf = this.tmpBuf;
    this.tintFn(src, srcOffset, tmpBuf, 0);
    this.base.getRgbItem(tmpBuf, 0, dest, destOffset);
  }

  getRgbBuffer(src, srcOffset, count, dest, destOffset, bits, alpha01) {
    if (typeof PDFJSDev === 'undefined' ||
        PDFJSDev.test('!PRODUCTION || TESTING')) {
      assert(dest instanceof Uint8ClampedArray,
             'AlternateCS.getRgbBuffer: Unsupported "dest" type.');
    }
    let tintFn = this.tintFn;
    let base = this.base;
    let scale = 1 / ((1 << bits) - 1);
    let baseNumComps = base.numComps;
    let usesZeroToOneRange = base.usesZeroToOneRange;
    let isPassthrough = (base.isPassthrough(8) || !usesZeroToOneRange) &&
                        alpha01 === 0;
    let pos = isPassthrough ? destOffset : 0;
    let baseBuf = isPassthrough ?
                  dest : new Uint8ClampedArray(baseNumComps * count);
    let numComps = this.numComps;

    let scaled = new Float32Array(numComps);
    let tinted = new Float32Array(baseNumComps);
    let i, j;

    for (i = 0; i < count; i++) {
      for (j = 0; j < numComps; j++) {
        scaled[j] = src[srcOffset++] * scale;
      }
      tintFn(scaled, 0, tinted, 0);
      if (usesZeroToOneRange) {
        for (j = 0; j < baseNumComps; j++) {
          baseBuf[pos++] = tinted[j] * 255;
        }
      } else {
        base.getRgbItem(tinted, 0, baseBuf, pos);
        pos += baseNumComps;
      }
    }

    if (!isPassthrough) {
      base.getRgbBuffer(baseBuf, 0, count, dest, destOffset, 8, alpha01);
    }
  }

  getOutputLength(inputLength, alpha01) {
    return this.base.getOutputLength(inputLength *
                                     this.base.numComps / this.numComps,
                                     alpha01);
  }

  isDefaultDecode(decodeMap, bpc) {
    return ColorSpace.isDefaultDecode(decodeMap, this.numComps);
  }
}

class PatternCS extends ColorSpace {
  constructor(baseCS) {
    super('Pattern', null);
    this.base = baseCS;
  }
}

/**
 * The default color is `new Uint8Array([0])`.
 */
class IndexedCS extends ColorSpace {
  constructor(base, highVal, lookup) {
    super('Indexed', 1);
    this.base = base;
    this.highVal = highVal;

    let baseNumComps = base.numComps;
    let length = baseNumComps * highVal;

    if (isStream(lookup)) {
      this.lookup = new Uint8Array(length);
      let bytes = lookup.getBytes(length);
      this.lookup.set(bytes);
    } else if (isString(lookup)) {
      this.lookup = new Uint8Array(length);
      for (let i = 0; i < length; ++i) {
        this.lookup[i] = lookup.charCodeAt(i);
      }
    } else if (lookup instanceof Uint8Array) {
      this.lookup = lookup;
    } else {
      throw new FormatError(`Unrecognized lookup table: ${lookup}`);
    }
  }

  getRgbItem(src, srcOffset, dest, destOffset) {
    if (typeof PDFJSDev === 'undefined' ||
        PDFJSDev.test('!PRODUCTION || TESTING')) {
      assert(dest instanceof Uint8ClampedArray,
             'IndexedCS.getRgbItem: Unsupported "dest" type.');
    }
    let numComps = this.base.numComps;
    let start = src[srcOffset] * numComps;
    this.base.getRgbBuffer(this.lookup, start, 1, dest, destOffset, 8, 0);
  }

  getRgbBuffer(src, srcOffset, count, dest, destOffset, bits, alpha01) {
    if (typeof PDFJSDev === 'undefined' ||
        PDFJSDev.test('!PRODUCTION || TESTING')) {
      assert(dest instanceof Uint8ClampedArray,
             'IndexedCS.getRgbBuffer: Unsupported "dest" type.');
    }
    let base = this.base;
    let numComps = base.numComps;
    let outputDelta = base.getOutputLength(numComps, alpha01);
    let lookup = this.lookup;

    for (let i = 0; i < count; ++i) {
      let lookupPos = src[srcOffset++] * numComps;
      base.getRgbBuffer(lookup, lookupPos, 1, dest, destOffset, 8, alpha01);
      destOffset += outputDelta;
    }
  }

  getOutputLength(inputLength, alpha01) {
    return this.base.getOutputLength(inputLength * this.base.numComps, alpha01);
  }

  isDefaultDecode(decodeMap, bpc) {
    if (!Array.isArray(decodeMap)) {
      return true;
    }
    if (decodeMap.length !== 2) {
      warn('Decode map length is not correct');
      return true;
    }
    if (!Number.isInteger(bpc) || bpc < 1) {
      warn('Bits per component is not correct');
      return true;
    }
    return decodeMap[0] === 0 && decodeMap[1] === (1 << bpc) - 1;
  }
}

/**
 * The default color is `new Float32Array([0])`.
 */
class DeviceGrayCS extends ColorSpace {
  constructor() {
    super('DeviceGray', 1);
  }

  getRgbItem(src, srcOffset, dest, destOffset) {
    if (typeof PDFJSDev === 'undefined' ||
        PDFJSDev.test('!PRODUCTION || TESTING')) {
      assert(dest instanceof Uint8ClampedArray,
             'DeviceGrayCS.getRgbItem: Unsupported "dest" type.');
    }
    let c = src[srcOffset] * 255;
    dest[destOffset] = dest[destOffset + 1] = dest[destOffset + 2] = c;
  }

  getRgbBuffer(src, srcOffset, count, dest, destOffset, bits, alpha01) {
    if (typeof PDFJSDev === 'undefined' ||
        PDFJSDev.test('!PRODUCTION || TESTING')) {
      assert(dest instanceof Uint8ClampedArray,
             'DeviceGrayCS.getRgbBuffer: Unsupported "dest" type.');
    }
    let scale = 255 / ((1 << bits) - 1);
    let j = srcOffset, q = destOffset;
    for (let i = 0; i < count; ++i) {
      let c = scale * src[j++];
      dest[q++] = c;
      dest[q++] = c;
      dest[q++] = c;
      q += alpha01;
    }
  }

  getOutputLength(inputLength, alpha01) {
    return inputLength * (3 + alpha01);
  }

  isDefaultDecode(decodeMap, bpc) {
    return ColorSpace.isDefaultDecode(decodeMap, this.numComps);
  }
}

/**
 * The default color is `new Float32Array([0, 0, 0])`.
 */
class DeviceRgbCS extends ColorSpace {
  constructor() {
    super('DeviceRGB', 3);
  }

  getRgbItem(src, srcOffset, dest, destOffset) {
    if (typeof PDFJSDev === 'undefined' ||
        PDFJSDev.test('!PRODUCTION || TESTING')) {
      assert(dest instanceof Uint8ClampedArray,
             'DeviceRgbCS.getRgbItem: Unsupported "dest" type.');
    }
    dest[destOffset] = src[srcOffset] * 255;
    dest[destOffset + 1] = src[srcOffset + 1] * 255;
    dest[destOffset + 2] = src[srcOffset + 2] * 255;
  }

  getRgbBuffer(src, srcOffset, count, dest, destOffset, bits, alpha01) {
    if (typeof PDFJSDev === 'undefined' ||
        PDFJSDev.test('!PRODUCTION || TESTING')) {
      assert(dest instanceof Uint8ClampedArray,
             'DeviceRgbCS.getRgbBuffer: Unsupported "dest" type.');
    }
    if (bits === 8 && alpha01 === 0) {
      dest.set(src.subarray(srcOffset, srcOffset + count * 3), destOffset);
      return;
    }
    let scale = 255 / ((1 << bits) - 1);
    let j = srcOffset, q = destOffset;
    for (let i = 0; i < count; ++i) {
      dest[q++] = scale * src[j++];
      dest[q++] = scale * src[j++];
      dest[q++] = scale * src[j++];
      q += alpha01;
    }
  }

  getOutputLength(inputLength, alpha01) {
    return (inputLength * (3 + alpha01) / 3) | 0;
  }

  isPassthrough(bits) {
    return bits === 8;
  }

  isDefaultDecode(decodeMap, bpc) {
    return ColorSpace.isDefaultDecode(decodeMap, this.numComps);
  }
}

/**
 * The default color is `new Float32Array([0, 0, 0, 1])`.
 */
const DeviceCmykCS = (function DeviceCmykCSClosure() {
  // The coefficients below was found using numerical analysis: the method of
  // steepest descent for the sum((f_i - color_value_i)^2) for r/g/b colors,
  // where color_value is the tabular value from the table of sampled RGB colors
  // from CMYK US Web Coated (SWOP) colorspace, and f_i is the corresponding
  // CMYK color conversion using the estimation below:
  //   f(A, B,.. N) = Acc+Bcm+Ccy+Dck+c+Fmm+Gmy+Hmk+Im+Jyy+Kyk+Ly+Mkk+Nk+255
  function convertToRgb(src, srcOffset, srcScale, dest, destOffset) {
    let c = src[srcOffset] * srcScale;
    let m = src[srcOffset + 1] * srcScale;
    let y = src[srcOffset + 2] * srcScale;
    let k = src[srcOffset + 3] * srcScale;

    dest[destOffset] = 255 +
      c * (-4.387332384609988 * c + 54.48615194189176 * m +
           18.82290502165302 * y + 212.25662451639585 * k +
           -285.2331026137004) +
      m * (1.7149763477362134 * m - 5.6096736904047315 * y +
           -17.873870861415444 * k - 5.497006427196366) +
      y * (-2.5217340131683033 * y - 21.248923337353073 * k +
           17.5119270841813) +
      k * (-21.86122147463605 * k - 189.48180835922747);

    dest[destOffset + 1] = 255 +
      c * (8.841041422036149 * c + 60.118027045597366 * m +
           6.871425592049007 * y + 31.159100130055922 * k +
           -79.2970844816548) +
      m * (-15.310361306967817 * m + 17.575251261109482 * y +
           131.35250912493976 * k - 190.9453302588951) +
      y * (4.444339102852739 * y + 9.8632861493405 * k - 24.86741582555878) +
      k * (-20.737325471181034 * k - 187.80453709719578);

    dest[destOffset + 2] = 255 +
      c * (0.8842522430003296 * c + 8.078677503112928 * m +
           30.89978309703729 * y - 0.23883238689178934 * k +
           -14.183576799673286) +
      m * (10.49593273432072 * m + 63.02378494754052 * y +
           50.606957656360734 * k - 112.23884253719248) +
      y * (0.03296041114873217 * y + 115.60384449646641 * k +
           -193.58209356861505) +
      k * (-22.33816807309886 * k - 180.12613974708367);
  }

  class DeviceCmykCS extends ColorSpace {
    constructor() {
      super('DeviceCMYK', 4);
    }

    getRgbItem(src, srcOffset, dest, destOffset) {
      if (typeof PDFJSDev === 'undefined' ||
          PDFJSDev.test('!PRODUCTION || TESTING')) {
        assert(dest instanceof Uint8ClampedArray,
               'DeviceCmykCS.getRgbItem: Unsupported "dest" type.');
      }
      convertToRgb(src, srcOffset, 1, dest, destOffset);
    }

    getRgbBuffer(src, srcOffset, count, dest, destOffset, bits, alpha01) {
      if (typeof PDFJSDev === 'undefined' ||
          PDFJSDev.test('!PRODUCTION || TESTING')) {
        assert(dest instanceof Uint8ClampedArray,
               'DeviceCmykCS.getRgbBuffer: Unsupported "dest" type.');
      }
      let scale = 1 / ((1 << bits) - 1);
      for (let i = 0; i < count; i++) {
        convertToRgb(src, srcOffset, scale, dest, destOffset);
        srcOffset += 4;
        destOffset += 3 + alpha01;
      }
    }

    getOutputLength(inputLength, alpha01) {
      return (inputLength / 4 * (3 + alpha01)) | 0;
    }

    isDefaultDecode(decodeMap, bpc) {
      return ColorSpace.isDefaultDecode(decodeMap, this.numComps);
    }
  }
  return DeviceCmykCS;
})();

/**
 * CalGrayCS: Based on "PDF Reference, Sixth Ed", p.245
 *
 * The default color is `new Float32Array([0])`.
 */
const CalGrayCS = (function CalGrayCSClosure() {
  function convertToRgb(cs, src, srcOffset, dest, destOffset, scale) {
    // A represents a gray component of a calibrated gray space.
    // A <---> AG in the spec
    let A = src[srcOffset] * scale;
    let AG = Math.pow(A, cs.G);

    // Computes L as per spec. ( = cs.YW * AG )
    // Except if other than default BlackPoint values are used.
    let L = cs.YW * AG;
    // http://www.poynton.com/notes/colour_and_gamma/ColorFAQ.html, Ch 4.
    // Convert values to rgb range [0, 255].
    let val = Math.max(295.8 * Math.pow(L, 0.333333333333333333) - 40.8, 0);
    dest[destOffset] = val;
    dest[destOffset + 1] = val;
    dest[destOffset + 2] = val;
  }

  class CalGrayCS extends ColorSpace {
    constructor(whitePoint, blackPoint, gamma) {
      super('CalGray', 1);

      if (!whitePoint) {
        throw new FormatError(
          'WhitePoint missing - required for color space CalGray');
      }
      blackPoint = blackPoint || [0, 0, 0];
      gamma = gamma || 1;

      // Translate arguments to spec variables.
      this.XW = whitePoint[0];
      this.YW = whitePoint[1];
      this.ZW = whitePoint[2];

      this.XB = blackPoint[0];
      this.YB = blackPoint[1];
      this.ZB = blackPoint[2];

      this.G = gamma;

      // Validate variables as per spec.
      if (this.XW < 0 || this.ZW < 0 || this.YW !== 1) {
        throw new FormatError(`Invalid WhitePoint components for ${this.name}` +
                              ', no fallback available');
      }

      if (this.XB < 0 || this.YB < 0 || this.ZB < 0) {
        info(`Invalid BlackPoint for ${this.name}, falling back to default.`);
        this.XB = this.YB = this.ZB = 0;
      }

      if (this.XB !== 0 || this.YB !== 0 || this.ZB !== 0) {
        warn(`${this.name}, BlackPoint: XB: ${this.XB}, YB: ${this.YB}, ` +
             `ZB: ${this.ZB}, only default values are supported.`);
      }

      if (this.G < 1) {
        info(`Invalid Gamma: ${this.G} for ${this.name}, ` +
             'falling back to default.');
        this.G = 1;
      }
    }

    getRgbItem(src, srcOffset, dest, destOffset) {
      if (typeof PDFJSDev === 'undefined' ||
          PDFJSDev.test('!PRODUCTION || TESTING')) {
        assert(dest instanceof Uint8ClampedArray,
               'CalGrayCS.getRgbItem: Unsupported "dest" type.');
      }
      convertToRgb(this, src, srcOffset, dest, destOffset, 1);
    }

    getRgbBuffer(src, srcOffset, count, dest, destOffset, bits, alpha01) {
      if (typeof PDFJSDev === 'undefined' ||
          PDFJSDev.test('!PRODUCTION || TESTING')) {
        assert(dest instanceof Uint8ClampedArray,
               'CalGrayCS.getRgbBuffer: Unsupported "dest" type.');
      }
      let scale = 1 / ((1 << bits) - 1);

      for (let i = 0; i < count; ++i) {
        convertToRgb(this, src, srcOffset, dest, destOffset, scale);
        srcOffset += 1;
        destOffset += 3 + alpha01;
      }
    }

    getOutputLength(inputLength, alpha01) {
      return inputLength * (3 + alpha01);
    }

    isDefaultDecode(decodeMap, bpc) {
      return ColorSpace.isDefaultDecode(decodeMap, this.numComps);
    }
  }
  return CalGrayCS;
})();

/**
 * CalRGBCS: Based on "PDF Reference, Sixth Ed", p.247
 *
 * The default color is `new Float32Array([0, 0, 0])`.
 */
const CalRGBCS = (function CalRGBCSClosure() {
  // See http://www.brucelindbloom.com/index.html?Eqn_ChromAdapt.html for these
  // matrices.
  const BRADFORD_SCALE_MATRIX = new Float32Array([
    0.8951, 0.2664, -0.1614,
    -0.7502, 1.7135, 0.0367,
    0.0389, -0.0685, 1.0296]);

  const BRADFORD_SCALE_INVERSE_MATRIX = new Float32Array([
    0.9869929, -0.1470543, 0.1599627,
    0.4323053, 0.5183603, 0.0492912,
    -0.0085287, 0.0400428, 0.9684867]);

  // See http://www.brucelindbloom.com/index.html?Eqn_RGB_XYZ_Matrix.html.
  const SRGB_D65_XYZ_TO_RGB_MATRIX = new Float32Array([
    3.2404542, -1.5371385, -0.4985314,
    -0.9692660, 1.8760108, 0.0415560,
    0.0556434, -0.2040259, 1.0572252]);

  const FLAT_WHITEPOINT_MATRIX = new Float32Array([1, 1, 1]);

  let tempNormalizeMatrix = new Float32Array(3);
  let tempConvertMatrix1 = new Float32Array(3);
  let tempConvertMatrix2 = new Float32Array(3);

  const DECODE_L_CONSTANT = Math.pow(((8 + 16) / 116), 3) / 8.0;

  function matrixProduct(a, b, result) {
    result[0] = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    result[1] = a[3] * b[0] + a[4] * b[1] + a[5] * b[2];
    result[2] = a[6] * b[0] + a[7] * b[1] + a[8] * b[2];
  }

  function convertToFlat(sourceWhitePoint, LMS, result) {
    result[0] = LMS[0] * 1 / sourceWhitePoint[0];
    result[1] = LMS[1] * 1 / sourceWhitePoint[1];
    result[2] = LMS[2] * 1 / sourceWhitePoint[2];
  }

  function convertToD65(sourceWhitePoint, LMS, result) {
    const D65X = 0.95047;
    const D65Y = 1;
    const D65Z = 1.08883;

    result[0] = LMS[0] * D65X / sourceWhitePoint[0];
    result[1] = LMS[1] * D65Y / sourceWhitePoint[1];
    result[2] = LMS[2] * D65Z / sourceWhitePoint[2];
  }

  function sRGBTransferFunction(color) {
    // See http://en.wikipedia.org/wiki/SRGB.
    if (color <= 0.0031308) {
      return adjustToRange(0, 1, 12.92 * color);
    }
    return adjustToRange(0, 1, (1 + 0.055) * Math.pow(color, 1 / 2.4) - 0.055);
  }

  function adjustToRange(min, max, value) {
    return Math.max(min, Math.min(max, value));
  }

  function decodeL(L) {
    if (L < 0) {
      return -decodeL(-L);
    }
    if (L > 8.0) {
      return Math.pow(((L + 16) / 116), 3);
    }
    return L * DECODE_L_CONSTANT;
  }

  function compensateBlackPoint(sourceBlackPoint, XYZ_Flat, result) {
    // In case the blackPoint is already the default blackPoint then there is
    // no need to do compensation.
    if (sourceBlackPoint[0] === 0 && sourceBlackPoint[1] === 0 &&
        sourceBlackPoint[2] === 0) {
      result[0] = XYZ_Flat[0];
      result[1] = XYZ_Flat[1];
      result[2] = XYZ_Flat[2];
      return;
    }

    // For the blackPoint calculation details, please see
    // http://www.adobe.com/content/dam/Adobe/en/devnet/photoshop/sdk/
    // AdobeBPC.pdf.
    // The destination blackPoint is the default blackPoint [0, 0, 0].
    let zeroDecodeL = decodeL(0);

    let X_DST = zeroDecodeL;
    let X_SRC = decodeL(sourceBlackPoint[0]);

    let Y_DST = zeroDecodeL;
    let Y_SRC = decodeL(sourceBlackPoint[1]);

    let Z_DST = zeroDecodeL;
    let Z_SRC = decodeL(sourceBlackPoint[2]);

    let X_Scale = (1 - X_DST) / (1 - X_SRC);
    let X_Offset = 1 - X_Scale;

    let Y_Scale = (1 - Y_DST) / (1 - Y_SRC);
    let Y_Offset = 1 - Y_Scale;

    let Z_Scale = (1 - Z_DST) / (1 - Z_SRC);
    let Z_Offset = 1 - Z_Scale;

    result[0] = XYZ_Flat[0] * X_Scale + X_Offset;
    result[1] = XYZ_Flat[1] * Y_Scale + Y_Offset;
    result[2] = XYZ_Flat[2] * Z_Scale + Z_Offset;
  }

  function normalizeWhitePointToFlat(sourceWhitePoint, XYZ_In, result) {
    // In case the whitePoint is already flat then there is no need to do
    // normalization.
    if (sourceWhitePoint[0] === 1 && sourceWhitePoint[2] === 1) {
      result[0] = XYZ_In[0];
      result[1] = XYZ_In[1];
      result[2] = XYZ_In[2];
      return;
    }

    let LMS = result;
    matrixProduct(BRADFORD_SCALE_MATRIX, XYZ_In, LMS);

    let LMS_Flat = tempNormalizeMatrix;
    convertToFlat(sourceWhitePoint, LMS, LMS_Flat);

    matrixProduct(BRADFORD_SCALE_INVERSE_MATRIX, LMS_Flat, result);
  }

  function normalizeWhitePointToD65(sourceWhitePoint, XYZ_In, result) {
    let LMS = result;
    matrixProduct(BRADFORD_SCALE_MATRIX, XYZ_In, LMS);

    let LMS_D65 = tempNormalizeMatrix;
    convertToD65(sourceWhitePoint, LMS, LMS_D65);

    matrixProduct(BRADFORD_SCALE_INVERSE_MATRIX, LMS_D65, result);
  }

  function convertToRgb(cs, src, srcOffset, dest, destOffset, scale) {
    // A, B and C represent a red, green and blue components of a calibrated
    // rgb space.
    let A = adjustToRange(0, 1, src[srcOffset] * scale);
    let B = adjustToRange(0, 1, src[srcOffset + 1] * scale);
    let C = adjustToRange(0, 1, src[srcOffset + 2] * scale);

    // A <---> AGR in the spec
    // B <---> BGG in the spec
    // C <---> CGB in the spec
    let AGR = Math.pow(A, cs.GR);
    let BGG = Math.pow(B, cs.GG);
    let CGB = Math.pow(C, cs.GB);

    // Computes intermediate variables L, M, N as per spec.
    // To decode X, Y, Z values map L, M, N directly to them.
    let X = cs.MXA * AGR + cs.MXB * BGG + cs.MXC * CGB;
    let Y = cs.MYA * AGR + cs.MYB * BGG + cs.MYC * CGB;
    let Z = cs.MZA * AGR + cs.MZB * BGG + cs.MZC * CGB;

    // The following calculations are based on this document:
    // http://www.adobe.com/content/dam/Adobe/en/devnet/photoshop/sdk/
    // AdobeBPC.pdf.
    let XYZ = tempConvertMatrix1;
    XYZ[0] = X;
    XYZ[1] = Y;
    XYZ[2] = Z;
    let XYZ_Flat = tempConvertMatrix2;

    normalizeWhitePointToFlat(cs.whitePoint, XYZ, XYZ_Flat);

    let XYZ_Black = tempConvertMatrix1;
    compensateBlackPoint(cs.blackPoint, XYZ_Flat, XYZ_Black);

    let XYZ_D65 = tempConvertMatrix2;
    normalizeWhitePointToD65(FLAT_WHITEPOINT_MATRIX, XYZ_Black, XYZ_D65);

    let SRGB = tempConvertMatrix1;
    matrixProduct(SRGB_D65_XYZ_TO_RGB_MATRIX, XYZ_D65, SRGB);

    // Convert the values to rgb range [0, 255].
    dest[destOffset] = sRGBTransferFunction(SRGB[0]) * 255;
    dest[destOffset + 1] = sRGBTransferFunction(SRGB[1]) * 255;
    dest[destOffset + 2] = sRGBTransferFunction(SRGB[2]) * 255;
  }

  class CalRGBCS extends ColorSpace {
    constructor(whitePoint, blackPoint, gamma, matrix) {
      super('CalRGB', 3);

      if (!whitePoint) {
        throw new FormatError(
          'WhitePoint missing - required for color space CalRGB');
      }
      blackPoint = blackPoint || new Float32Array(3);
      gamma = gamma || new Float32Array([1, 1, 1]);
      matrix = matrix || new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);

      // Translate arguments to spec variables.
      let XW = whitePoint[0];
      let YW = whitePoint[1];
      let ZW = whitePoint[2];
      this.whitePoint = whitePoint;

      let XB = blackPoint[0];
      let YB = blackPoint[1];
      let ZB = blackPoint[2];
      this.blackPoint = blackPoint;

      this.GR = gamma[0];
      this.GG = gamma[1];
      this.GB = gamma[2];

      this.MXA = matrix[0];
      this.MYA = matrix[1];
      this.MZA = matrix[2];
      this.MXB = matrix[3];
      this.MYB = matrix[4];
      this.MZB = matrix[5];
      this.MXC = matrix[6];
      this.MYC = matrix[7];
      this.MZC = matrix[8];

      // Validate variables as per spec.
      if (XW < 0 || ZW < 0 || YW !== 1) {
        throw new FormatError(`Invalid WhitePoint components for ${this.name}` +
                              ', no fallback available');
      }

      if (XB < 0 || YB < 0 || ZB < 0) {
        info(`Invalid BlackPoint for ${this.name} [${XB}, ${YB}, ${ZB}], ` +
             'falling back to default.');
        this.blackPoint = new Float32Array(3);
      }

      if (this.GR < 0 || this.GG < 0 || this.GB < 0) {
        info(`Invalid Gamma [${this.GR}, ${this.GG}, ${this.GB}] for ` +
             `${this.name}, falling back to default.`);
        this.GR = this.GG = this.GB = 1;
      }
    }

    getRgbItem(src, srcOffset, dest, destOffset) {
      if (typeof PDFJSDev === 'undefined' ||
          PDFJSDev.test('!PRODUCTION || TESTING')) {
        assert(dest instanceof Uint8ClampedArray,
               'CalRGBCS.getRgbItem: Unsupported "dest" type.');
      }
      convertToRgb(this, src, srcOffset, dest, destOffset, 1);
    }

    getRgbBuffer(src, srcOffset, count, dest, destOffset, bits, alpha01) {
      if (typeof PDFJSDev === 'undefined' ||
          PDFJSDev.test('!PRODUCTION || TESTING')) {
        assert(dest instanceof Uint8ClampedArray,
              'CalRGBCS.getRgbBuffer: Unsupported "dest" type.');
      }
      let scale = 1 / ((1 << bits) - 1);

      for (let i = 0; i < count; ++i) {
        convertToRgb(this, src, srcOffset, dest, destOffset, scale);
        srcOffset += 3;
        destOffset += 3 + alpha01;
      }
    }

    getOutputLength(inputLength, alpha01) {
      return (inputLength * (3 + alpha01) / 3) | 0;
    }

    isDefaultDecode(decodeMap, bpc) {
      return ColorSpace.isDefaultDecode(decodeMap, this.numComps);
    }
  }
  return CalRGBCS;
})();

/**
 * LabCS: Based on "PDF Reference, Sixth Ed", p.250
 *
 * The default color is `new Float32Array([0, 0, 0])`.
 */
const LabCS = (function LabCSClosure() {
  // Function g(x) from spec
  function fn_g(x) {
    let result;
    if (x >= 6 / 29) {
      result = x * x * x;
    } else {
      result = (108 / 841) * (x - 4 / 29);
    }
    return result;
  }

  function decode(value, high1, low2, high2) {
    return low2 + (value) * (high2 - low2) / (high1);
  }

  // If decoding is needed maxVal should be 2^bits per component - 1.
  function convertToRgb(cs, src, srcOffset, maxVal, dest, destOffset) {
    // XXX: Lab input is in the range of [0, 100], [amin, amax], [bmin, bmax]
    // not the usual [0, 1]. If a command like setFillColor is used the src
    // values will already be within the correct range. However, if we are
    // converting an image we have to map the values to the correct range given
    // above.
    // Ls,as,bs <---> L*,a*,b* in the spec
    let Ls = src[srcOffset];
    let as = src[srcOffset + 1];
    let bs = src[srcOffset + 2];
    if (maxVal !== false) {
      Ls = decode(Ls, maxVal, 0, 100);
      as = decode(as, maxVal, cs.amin, cs.amax);
      bs = decode(bs, maxVal, cs.bmin, cs.bmax);
    }

    // Adjust limits of 'as' and 'bs'
    as = as > cs.amax ? cs.amax : as < cs.amin ? cs.amin : as;
    bs = bs > cs.bmax ? cs.bmax : bs < cs.bmin ? cs.bmin : bs;

    // Computes intermediate variables X,Y,Z as per spec
    let M = (Ls + 16) / 116;
    let L = M + (as / 500);
    let N = M - (bs / 200);

    let X = cs.XW * fn_g(L);
    let Y = cs.YW * fn_g(M);
    let Z = cs.ZW * fn_g(N);

    let r, g, b;
    // Using different conversions for D50 and D65 white points,
    // per http://www.color.org/srgb.pdf
    if (cs.ZW < 1) {
      // Assuming D50 (X=0.9642, Y=1.00, Z=0.8249)
      r = X * 3.1339 + Y * -1.6170 + Z * -0.4906;
      g = X * -0.9785 + Y * 1.9160 + Z * 0.0333;
      b = X * 0.0720 + Y * -0.2290 + Z * 1.4057;
    } else {
      // Assuming D65 (X=0.9505, Y=1.00, Z=1.0888)
      r = X * 3.2406 + Y * -1.5372 + Z * -0.4986;
      g = X * -0.9689 + Y * 1.8758 + Z * 0.0415;
      b = X * 0.0557 + Y * -0.2040 + Z * 1.0570;
    }
    // Convert the color values to the [0,255] range (clamping is automatic).
    dest[destOffset] = Math.sqrt(r) * 255;
    dest[destOffset + 1] = Math.sqrt(g) * 255;
    dest[destOffset + 2] = Math.sqrt(b) * 255;
  }

  class LabCS extends ColorSpace {
    constructor(whitePoint, blackPoint, range) {
      super('Lab', 3);

      if (!whitePoint) {
        throw new FormatError(
          'WhitePoint missing - required for color space Lab');
      }
      blackPoint = blackPoint || [0, 0, 0];
      range = range || [-100, 100, -100, 100];

      // Translate args to spec variables
      this.XW = whitePoint[0];
      this.YW = whitePoint[1];
      this.ZW = whitePoint[2];
      this.amin = range[0];
      this.amax = range[1];
      this.bmin = range[2];
      this.bmax = range[3];

      // These are here just for completeness - the spec doesn't offer any
      // formulas that use BlackPoint in Lab
      this.XB = blackPoint[0];
      this.YB = blackPoint[1];
      this.ZB = blackPoint[2];

      // Validate vars as per spec
      if (this.XW < 0 || this.ZW < 0 || this.YW !== 1) {
        throw new FormatError(
          'Invalid WhitePoint components, no fallback available');
      }

      if (this.XB < 0 || this.YB < 0 || this.ZB < 0) {
        info('Invalid BlackPoint, falling back to default');
        this.XB = this.YB = this.ZB = 0;
      }

      if (this.amin > this.amax || this.bmin > this.bmax) {
        info('Invalid Range, falling back to defaults');
        this.amin = -100;
        this.amax = 100;
        this.bmin = -100;
        this.bmax = 100;
      }
    }

    getRgbItem(src, srcOffset, dest, destOffset) {
      if (typeof PDFJSDev === 'undefined' ||
          PDFJSDev.test('!PRODUCTION || TESTING')) {
        assert(dest instanceof Uint8ClampedArray,
               'LabCS.getRgbItem: Unsupported "dest" type.');
      }
      convertToRgb(this, src, srcOffset, false, dest, destOffset);
    }

    getRgbBuffer(src, srcOffset, count, dest, destOffset, bits, alpha01) {
      if (typeof PDFJSDev === 'undefined' ||
          PDFJSDev.test('!PRODUCTION || TESTING')) {
        assert(dest instanceof Uint8ClampedArray,
               'LabCS.getRgbBuffer: Unsupported "dest" type.');
      }
      let maxVal = (1 << bits) - 1;
      for (let i = 0; i < count; i++) {
        convertToRgb(this, src, srcOffset, maxVal, dest, destOffset);
        srcOffset += 3;
        destOffset += 3 + alpha01;
      }
    }

    getOutputLength(inputLength, alpha01) {
      return (inputLength * (3 + alpha01) / 3) | 0;
    }

    isDefaultDecode(decodeMap, bpc) {
      // XXX: Decoding is handled with the lab conversion because of the strange
      // ranges that are used.
      return true;
    }

    get usesZeroToOneRange() {
      return shadow(this, 'usesZeroToOneRange', false);
    }
  }
  return LabCS;
})();

export {
  ColorSpace,
};
