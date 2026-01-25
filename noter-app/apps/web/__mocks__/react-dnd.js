module.exports = {
  useDrag: () => [{ isDragging: false }, (x) => x, (x) => x],
  useDrop: () => [{ isOver: false, canDrop: false }, (x) => x],
  DndProvider: ({ children }) => children,
};
