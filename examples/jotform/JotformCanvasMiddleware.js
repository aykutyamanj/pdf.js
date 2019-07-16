class JotformCanvasMiddleware {

  constructor() {
    this.images = [];
  }

  process(type, data) {
    console.log(type, data);
    if (type === 'image') {
      this.images.push(this.processImage(data));
    }
  }

  processImage(data) {
    return data;
  }
}

module.exports = JotformCanvasMiddleware;