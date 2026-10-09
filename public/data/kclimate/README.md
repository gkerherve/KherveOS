# kClimate data

Open climate datasets used by kClimate, as compact CSV. They are fetched and converted by
`tools/fetch_kclimate_data.py` (Python standard library only): every value is parsed from the provider's own file,
none is typed in or estimated. Run `python3 tools/fetch_kclimate_data.py` to refresh them. `manifest.json` holds the
same information for the app (Data sources panel) and the tests (row counts and time ranges).

Monthly files have `year,month` columns; annual and irregular ones a `time` column (decimal year, the middle of
the period). Empty cells are missing values.

## Atmospheric CO2 at Mauna Loa, monthly

- File: `co2_mlo.csv` (822 rows, 1958-03 to 2026-08, monthly)
- Provider: NOAA Global Monitoring Laboratory (GML), with the 1958-1974 record of C. D. Keeling, Scripps Institution of Oceanography
- URL: https://gml.noaa.gov/ccgg/trends/data.html
- Licence / terms: US Government work, public domain; NOAA asks for credit and a citation (Lan et al., NOAA GML)
- Version: NOAA GML co2_mm_mlo.csv, file created Sat Sep  5 03:55:38 2026
- Retrieved: 2026-10-08
- Cite as: Lan, X., Tans, P. and Thoning, K.W.: Trends in globally-averaged CO2 determined from NOAA Global Monitoring Laboratory measurements.
- Columns: `co2` (ppm); `co2_deseasonalized` (ppm)
- Monthly mean dry-air CO2 mole fraction at Mauna Loa (ppm) and the same with the seasonal cycle removed.
- Missing values: No month is empty: NOAA fills the few months without measurements by interpolation (ndays = -1 in its file) and says so in the file header. The deseasonalized column is the provider's own.

## GISTEMP v4 surface temperature anomaly: global, northern and southern hemisphere, monthly

- File: `gistemp.csv` (1760 rows, 1880-01 to 2026-08, monthly)
- Provider: NASA Goddard Institute for Space Studies (GISS)
- URL: https://data.giss.nasa.gov/gistemp/
- Licence / terms: NASA data, public domain; GISS asks to cite GISTEMP Team and Lenssen et al. (2024)
- Version: GISTEMP v4 (LOTI, ERSSTv5 ocean)
- Retrieved: 2026-10-08
- Cite as: GISTEMP Team: GISS Surface Temperature Analysis (GISTEMP), version 4. NASA GISS. Lenssen, N. et al. (2024), J. Geophys. Res. Atmos., doi:10.1029/2023JD040179.
- Columns: `global` (°C); `nh` (°C); `sh` (°C)
- Land-ocean temperature index (LOTI), anomalies in degrees C relative to 1951-1980.
- Missing values: The provider publishes values to 0.01 °C; months not yet analysed are left empty.

## HadCRUT5 global temperature anomaly, monthly, with 95 % uncertainty range

- File: `hadcrut5.csv` (2120 rows, 1850-01 to 2026-08, monthly)
- Provider: Met Office Hadley Centre / Climatic Research Unit, University of East Anglia
- URL: https://www.metoffice.gov.uk/hadobs/hadcrut5/
- Licence / terms: Open Government Licence v3.0 (contains public sector information); cite Morice et al. (2021)
- Version: HadCRUT.5.2.0.0, analysis, global monthly summary series
- Retrieved: 2026-10-08
- Cite as: Morice, C.P. et al. (2021), An updated assessment of near-surface temperature change from 1850: the HadCRUT5 data set, J. Geophys. Res. Atmos., 126, e2019JD032361.
- Columns: `anomaly` (°C); `lower` (°C); `upper` (°C)
- Global mean near-surface temperature anomaly (degrees C) relative to 1961-1990, 1850 to now, with the lower and upper 95 % limits.

## Oceanic Nino Index (ONI), ENSO

- File: `oni.csv` (920 rows, 1950-01 to 2026-08, monthly)
- Provider: NOAA Climate Prediction Center (CPC)
- URL: https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/ensostuff/ONI_v5.php
- Licence / terms: US Government work, public domain
- Version: ONI based on ERSSTv5
- Retrieved: 2026-10-08
- Cite as: NOAA CPC: Oceanic Nino Index (ONI), ERSSTv5 Nino 3.4 region, 3-month running mean.
- Columns: `oni` (°C); `nino34_sst` (°C)
- 3-month running mean of the Nino 3.4 sea-surface temperature anomaly (degrees C, ERSSTv5, centred 30-year base periods). Each value is placed on the middle month of its 3-month season (DJF = January).
- Missing values: Each 3-month season is placed on its middle month, so the record ends one month before the latest month observed.

## Arctic sea-ice extent, monthly (Sea Ice Index)

- File: `arctic_sea_ice.csv` (575 rows, 1978-11 to 2026-09, monthly)
- Provider: NOAA@NSIDC, National Snow and Ice Data Center
- URL: https://nsidc.org/data/g02135/versions/4
- Licence / terms: Free and open access; citation required as a condition of use (Fetterer et al., doi:10.7265/a98x-0f50)
- Version: Sea Ice Index v4.0 (monthly extent files)
- Retrieved: 2026-10-08
- Cite as: Fetterer, F., Knowles, K., Meier, W. N., Savoie, M., Windnagel, A. K. & Stafford, T. Sea Ice Index, Version 4 (G02135). NSIDC. doi:10.7265/a98x-0f50.
- Columns: `extent` (million km²); `area` (million km²)
- Monthly mean Northern Hemisphere sea-ice extent and area, millions of km2, from passive-microwave satellites, November 1978 onwards (two months, December 1987 and January 1988, have no data).

## World CO2 emissions per year (fossil fuels, cement, land use)

- File: `owid_world_co2.csv` (275 rows, 1750 to 2024, annual)
- Provider: Our World in Data, from the Global Carbon Project (Global Carbon Budget) and others
- URL: https://github.com/owid/co2-data
- Licence / terms: Creative Commons Attribution 4.0 (CC BY 4.0); credit Our World in Data and the Global Carbon Project
- Version: master branch as retrieved
- Retrieved: 2026-10-08
- Cite as: Our World in Data CO2 and Greenhouse Gas Emissions dataset, based on the Global Carbon Budget (Friedlingstein et al.), World rows.
- Columns: `co2` (Mt CO₂); `co2_including_luc` (Mt CO₂); `cumulative_co2` (Mt CO₂ (cumulative)); `cumulative_co2_including_luc` (Mt CO₂ (cumulative)); `coal_co2` (Mt CO₂); `oil_co2` (Mt CO₂); `gas_co2` (Mt CO₂); `cement_co2` (Mt CO₂); `land_use_change_co2` (Mt CO₂)
- Annual emissions of the world, million tonnes of CO2 (fossil fuels and cement; including land-use change from 1850), and cumulative totals.
- Missing values: Series start when the provider's estimates start (fossil CO2 1750, oil 1855, gas 1882, cement 1880, land use 1850).

## Global mean sea level, tide-gauge reconstruction 1880-2013

- File: `sealevel_csiro.csv` (134 rows, 1880 to 2013, annual)
- Provider: CSIRO (Church and White 2011, updated 2015)
- URL: https://research.csiro.au/slrwavescoast/sea-level/
- Licence / terms: Free to use; the provider asks that the source is acknowledged. The data page states no formal licence
- Version: Church and White 2011, update to 2013 (files dated June 2015)
- Retrieved: 2026-10-08
- Cite as: Church, J.A. and White, N.J. (2011), Sea-level rise from the late 19th to the early 21st century, Surveys in Geophysics, 32, 585-602.
- Columns: `gmsl_mm` (mm); `uncertainty_mm` (mm)
- Annual global mean sea level in mm (arbitrary zero), with its uncertainty, reconstructed from tide gauges.

## Global mean sea level from satellite altimetry, 1993-now

- File: `sealevel_noaa_altimetry.csv` (1557 rows, 1992 to 2025, irregular)
- Provider: NOAA Laboratory for Satellite Altimetry (STAR)
- URL: https://www.star.nesdis.noaa.gov/socd/lsa/SeaLevelRise/
- Licence / terms: US Government work, public domain; acknowledgment requested: 'Altimetry data are provided by NOAA Laboratory for Satellite Altimetry.'
- Version: slr_sla_gbl_free_all_66
- Retrieved: 2026-10-08
- Cite as: NOAA Laboratory for Satellite Altimetry: Sea level rise (TOPEX/Poseidon, Jason-1/2/3, Sentinel-6MF), global ocean 66S to 66N, annual signals removed, no glacial isostatic adjustment.
- Columns: `gmsl_mm` (mm)
- Global mean sea level anomaly in mm from successive altimetry missions, about every 10 days, annual cycle removed.
- Note: Provider's own trend of the whole record: 3.17 mm/year (no glacial isostatic adjustment correction).

## Stratospheric aerosol optical depth (volcanic forcing) 1850-2012

- File: `giss_aod.csv` (1953 rows, 1850-01 to 2012-09, monthly)
- Provider: NASA Goddard Institute for Space Studies (Sato, Lacis, Hansen)
- URL: https://data.giss.nasa.gov/modelforce/strataer/
- Licence / terms: NASA data, public domain; cite Sato et al. (1993) and the GISS forcing page
- Version: tau.line_2012.12
- Retrieved: 2026-10-08
- Cite as: Sato, M., Hansen, J.E., McCormick, M.P. and Pollack, J.B. (1993), Stratospheric aerosol optical depths 1850-1990, J. Geophys. Res., 98, 22987-22994 (extended by GISS to 2012).
- Columns: `global` (no unit); `nh` (no unit); `sh` (no unit)
- Monthly global and hemispheric mean stratospheric aerosol optical depth at 550 nm (dimensionless), a measure of volcanic eruptions.

## Not included

- Solar activity (sunspot number): the SILSO series is licensed CC BY-NC (non-commercial), so it is not shipped. The NOAA SWPC F10.7 table starts only in 2004. Import one with File > Import CSV.
- Ice-core CO2 before 1958: not downloaded; the model builds the earlier path from cumulative emissions and says so.
