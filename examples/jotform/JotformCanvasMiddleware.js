class JotformCanvasMiddleware {

  constructor() {
    this.images = [];
    this.rectangles = [];
    this.lines = [];
  }

  transform(inVector, inMatrix) {
    if (!inMatrix) {
      return inVector;
    }
    return [
      inMatrix[0] * inVector[0] + inMatrix[2] * inVector[1] + inMatrix[4],
      inMatrix[1] * inVector[0] + inMatrix[3] * inVector[1] + inMatrix[5]
    ];
  }

  process(type, data, ctx) {
    if (type === 'image') {
      this.images.push(this.processImage(data));
    }

    if (type === 'rect') {
      const rect = this.processRectangle(data, ctx);
      this.rectangles.push(rect);
    }

    if (type === 'line') {
      const line = this.processLine(data, ctx);
      this.lines.push(line);
    }
  }

  processImage(data) {
    return data;
  }

  processRectangle(data, ctx) {
    const transformMatrix = ctx.mozCurrentTransform;
    const from = this.transform([data[0], data[1]], transformMatrix);
    const to = this.transform([data[2], data[3]], transformMatrix);
    return [...from, ...to];
  }

  processLine(data, ctx) {
    const transformMatrix = ctx.mozCurrentTransform;
    const from = this.transform([data[0], data[1]], transformMatrix);
    const to = this.transform([data[2], data[3]], transformMatrix);
    return [...from, ...to];
  }
}

module.exports = JotformCanvasMiddleware;
