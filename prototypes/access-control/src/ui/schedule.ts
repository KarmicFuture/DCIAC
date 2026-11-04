type Paint = () => void;

let paint: Paint = () => {};

export function bindRender(fn: Paint) {
  paint = fn;
}

export function render() {
  paint();
}
