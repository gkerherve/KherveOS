"""The Shirley background of lmfitxps 4.1.2 (lmfitxps.backgrounds.shirley_calculate).

Copied so that KherveFitting's backgrounds do not need lmfitxps (and its
plotting dependencies) inside Pyodide. The code is unchanged.

lmfitxps — MIT License — Copyright (c) 2023 Julian-Hochhaus.
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions: The above copyright
notice and this permission notice shall be included in all copies or
substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS",
WITHOUT WARRANTY OF ANY KIND.
"""

import numpy as np
from scipy.integrate import cumulative_trapezoid


def shirley_calculate(x, y, tol=1e-5, maxit=10, bounds=None):
    """
    Calculates the Shirley background for a given set of x (energy) and y (intensity) data.

    The implementation was inspired by the python implementation of Kane O'Donnell [5]_.

    The Shirley background is calculated iteratively:

    .. math::
        :label: shirleystatic

        B_{S, n}(E) = k_n \\cdot \\int_{E}^{E_{\\text{right}}} [I(E') - I_{\\text{right}} - B_{S, n-1}(E')] \\, dE'


    where:
        - :math:`B_{S, n}(E)` represents the Shirley background at :math:`E` in the :math:`n`-th iteration,
        - :math:`I(E')` is the intensity at :math:`E'`,
        - :math:`k_n` is the Shirley scaling parameter for the :math:`n`-th iteration.
        - :math:`E_{\\text{right}}` and :math:`I_{\\text{right}}` are the rightmost energy/intensity of the dataset.

    The iterative process continues until the difference :math:`B_{S, n}(E) - B_{S, n-1}(E)` is suitable small or the number of maximum iterations :math:`maxit` is exceeded.

    Initially, :math:`B_{S, 0}(E)=0` is choosen and :math:`k_n` is found from the requirement, that :math:`\\left(I_{\\text{left}}-B_{S, n}(E_{\\text{left}})\\right)=0`.
    For further details, please refer to e.g. S. Tougaard [6]_ .

    Typically, convergence is reached after :math:`\\approx 5` iterations. The convergence criterion is:

     .. math::
        :label: shirleyconvergence

        \\langle\\left(B_{S, n}(E)-B_{S, n-1}(E)\\right)^2\\rangle<tol


    Parameters:
    -----------

    .. table:: Available parameters
        :widths: auto

        +-----------+---------------+--------------------------------------------------------------------------------------------------------------------------------+
        | Parameter |  Type         | Description                                                                                                                    |
        +===========+===============+================================================================================================================================+
        | x         | :obj:`array`  | 1D-array containing the x-values (energies) of the spectrum.                                                                   |
        +-----------+---------------+--------------------------------------------------------------------------------------------------------------------------------+
        | y         | :obj:`array`  | 1D-array containing the y-values (intensities) of the spectrum.                                                                |
        +-----------+---------------+--------------------------------------------------------------------------------------------------------------------------------+
        | tol       | :obj:`float`  | Tolerance used to determine, when the convergence is reached in equation :math:numref:`shirleyconvergence`. Defaults to 1e-5.  |
        +-----------+---------------+--------------------------------------------------------------------------------------------------------------------------------+
        | maxit     | :obj:`int`    | Maximum number of iterations before calculation is interrupted. Defaults to 10.                                                |
        +-----------+---------------+--------------------------------------------------------------------------------------------------------------------------------+
        | bounds    | :obj:`tuple`  | Either two x values or two (x,y) pairs. Determines the edges of the Shirley background. Background will be constant outside this range. If only x is passed, picks the y of closest data point. If nothing is passed, uses the edges of the data range.    |
        +-----------+---------------+--------------------------------------------------------------------------------------------------------------------------------+

    Returns:
    --------
        :obj:`array`:  The function returns the calculated Shirley background as an :obj:`array`.

    Hint
    ----

    This function should be used, if you intend to calculate and remove the background from your data before starting the fitting procedure, if you instead wish to include the background in the fitting model, please use the desired background model, e.g. :ref:`ShirleyBG`.

    """

    # Sanity check: Do we actually have data to process here?
    if not (any(x) and any(y)):
        print("One of the arrays x or y is empty. Returning zero background.")
        return x * 0            # TODO: raise ValueError instead?
    if not len(x) == len(y):
        print("Length missmatch between x and y. Returning zero background")
        return x * 0            # TODO: raise ValueError instead?

    # couple x and y values for easier handling in the following;
    #  data will be modified in-place, but this keeps the input x,y safe.
    data = np.array((x, y))

    if not bounds:
        bounds = np.array((data[:, 0], data[:, -1])).T
    else:
        bounds = np.array(bounds).T
        if bounds.shape == (2,):
            # bounds are only energies, don't have values yet.
            # cut the range, then use closest data values.
            data = data[:, (data[0] >= np.min(bounds)) &
                           (data[0] <= np.max(bounds))]
            bounds = np.array((data[:,0], data[:,-1])).T
        else:
            # if bounds are not at the ends of the data,
            # consider only the inner parts of the data from here on
            data = data[:, (data[0] >= np.min(bounds[0])) &
                           (data[0] <= np.max(bounds[0]))]
            # make sure that bounds are actually part of the x range: 
            # keep their y values, put x on the closest existing point
            bounds[0, 0] = data[0, 0]
            bounds[0, 1] = data[0, -1]

    # ensure that the 'left' value of the data is higher than the 'right'
    # NOTE: This is insensitive to whether the energy axis is binding or
    # kinetic, but WILL give unphysical results where the background goes
    # 'up' without complaining if that's what's in the data!
    if data[1, 0] < data[1, -1]:
        is_reversed = True
        data = data[:,::-1]
    else:
        is_reversed = False
    # make the bounds follow the same order as the data;
    # i.e. if kinetic energy -> lower value first, otherwise higher first
    if (np.sign(bounds[0, 0] - bounds[0, -1])
            != np.sign(data[0, 0] - data[0, -1])):
        bounds = bounds[:, ::-1]

    # Initial value of the background shape B. The total background S = bounds[1,1] + B,
    # and B is initially zero
    B = data[1] * 0

    for it in range(maxit):
        # Calculate new k = (yl - yr) / (int_(xl)^(xr) J(x') - yr - B(x') dx')
        # background-subtracted y so far, and cumulative integral:
        y_sub = data[1] - B - bounds[1, 1]
        y_int = cumulative_trapezoid(y_sub[::-1], data[0, ::-1], initial=0)[::-1]
        # Calculate new k = (yl - yr) / (integral of y over the whole range)
        k = (bounds[1, 0] - bounds[1, 1]) / y_int[0]
        # new B is simply the cumulative integral normalized by the new k
        B_new = k*y_int
        # If B_new is close to B, exit.
        if np.sum((B - B_new)**2) / len(B) < tol:
            B = np.copy(B_new)
            break
        else:
            B = np.copy(B_new)
    # else:
    #     print("Max iterations exceeded before convergence.")


    B += bounds[1, 1]
    if is_reversed:
        B = B[::-1]
        data = data[:,::-1]

    # check the original data range, fill up the missing parts
    npx = np.array(x)
    index_exists = np.where((npx >= np.min(data[0])) & 
                            (npx <= np.max(data[0])))[0]
    B_whole_range = np.concatenate((
        np.full(index_exists[0], B[0]),
        B,
        np.full(len(npx) - index_exists[-1] - 1, B[-1])
        ))
    return B_whole_range


