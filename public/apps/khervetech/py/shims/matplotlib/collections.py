"""matplotlib.collections for the recording matplotlib."""
from ._rec import Collection, Scatter as PathCollection, FillBetween as PolyCollection  # noqa: F401
LineCollection = PolyCollection
