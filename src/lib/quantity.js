export const remainingQuantity = ({ quantity, available_quantity } = {}) => {
  const value = Number(available_quantity ?? quantity ?? 0);
  return Number.isFinite(value) ? Math.max(0, value) : 0;
};
