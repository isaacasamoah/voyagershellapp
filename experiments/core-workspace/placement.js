(() => {
  const sides = ["left", "right", "top", "bottom"];
  function side(rect, x, y) {
    const distances = [
      (x - rect.x) / rect.width,
      1 - (x - rect.x) / rect.width,
      (y - rect.y) / rect.height,
      1 - (y - rect.y) / rect.height,
    ];
    return sides[distances.indexOf(Math.min(...distances))];
  }
  function neighbour(rect, candidates, direction) {
    return candidates
      .map((item) => {
        const x = item.x + item.width / 2 - rect.x - rect.width / 2;
        const y = item.y + item.height / 2 - rect.y - rect.height / 2;
        const forward = { left: -x, right: x, top: -y, bottom: y }[direction];
        return { id: item.id, forward, distance: Math.hypot(x, y) };
      })
      .filter((item) => item.forward > 0)
      .sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id))[0]
      ?.id;
  }
  if (typeof module !== "undefined") module.exports = { side, neighbour };
  if (typeof window !== "undefined")
    window.vesselPlacement = { side, neighbour };
})();
