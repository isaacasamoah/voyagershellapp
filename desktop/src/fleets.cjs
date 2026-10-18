function fleetActions(rpc) {
  return {
    read: () => rpc('fleets'),
    create: (name, id) => rpc('create-fleet', id, name),
    move: (vessel, fleet) => rpc('move-vessel', vessel, fleet ?? 'none'),
    remove: (fleet) => rpc('remove-fleet', fleet),
  };
}
module.exports = { fleetActions };
