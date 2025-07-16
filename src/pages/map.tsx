import excelData from "@/assets/excel-data.json";
import MapModal from "@/components/MapModal";
import MapView from "@/components/MapView";
import DefaultLayout from "@/layouts/default";
import {
  Table,
  TableBody,
  TableCell,
  TableColumn,
  TableHeader,
  TableRow,
} from "@heroui/table";
import { Tab, Tabs } from "@heroui/tabs";
import type { Feature, Polygon } from "geojson";
import L, { Map as LeafletMap } from "leaflet";
import { Expand, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type ExcelMiningData = {
  "Группа ПИ"?: string;
  "№\nп.п."?: number | string;
  "\nНаименование месторождения, место расположения\n"?: string;
  "БИН"?: string;
  "Полезные ископаемые (запасы, годовой объем добычи)"?: string;
  "Вид проводимых работ"?: string;
  "Информация по недропользователю (наименование, место регестрации)"?: string;
  "Информация по контракту/лицензии (номер, дата и срок действия)"?: string;
  "Координаты"?: string;
  "Район"?: string;
};

type ParsedExcelData = {
  id: string;
  depositName: string;
  bin: string;
  minerals: string;
  workType: string;
  company: string;
  contractInfo: string;
  coordinates: [number, number][][]; // Parsed from WKT
  group: string;
};

type Company = {
  location: string;
  company_title: string;
  type: string; // "добыча" | "разведка"
  category: string; // "ОПИ" | "ТПИ"
};

type Region = {
  id: string;
  name: string;
  company: Company[];
  coordinates: [number, number][];
  url?: string;
};

function countUniqueCompanyTitles(region: Region): number {
  const titles = region.company.map((c) => c.company_title);
  const unique = new Set(titles);
  return unique.size;
}

function filterCompaniesByType(
  companies: Company[], // Changed to accept an array of companies
  type: "добыча" | "разведка",
): Company[] {
  return companies.filter((c) => c.type === type);
}

function filterCompaniesByCategory(
  region: Region,
  category: "ОПИ" | "ТПИ",
): Company[] {
  return region.company.filter((c) => c.category.toUpperCase().includes(category));
}

function countCompanyTypes(companies: Company[]): {
  разведка: number;
  добыча: number;
} {
  let result = { разведка: 0, добыча: 0 };
  for (const company of companies) {
    if (company.type === "разведка") {
      result.разведка++;
    } else if (company.type === "добыча") {
      result.добыча++;
    }
  }
  return result;
}

function countUniqueOPIandTPI(region: Region): { ОПИ: number; ТПИ: number } {
  const opiSet = new Set<string>();
  const tpiSet = new Set<string>();
  for (const company of region.company) {
    const category = company.category.toUpperCase();
    const title = company.company_title;
    if (category.includes("ОПИ")) {
      opiSet.add(title);
    } else if (category.includes("ТПИ")) {
      tpiSet.add(title);
    }
  }
  return { ОПИ: opiSet.size, ТПИ: tpiSet.size };
}

// Function to parse WKT coordinates
function parseWKTCoordinates(wkt: string): [number, number][][] {
  if (!wkt || typeof wkt !== 'string') return [];

  try {
    // Remove MULTIPOLYGON or POLYGON wrapper and extract coordinate pairs
    const coordinateString = wkt
      .replace(/^(MULTI)?POLYGON\s*\(\(/i, '')
      .replace(/\)\)$/, '')
      .trim();

    // Split by polygon boundaries for multipolygon
    const polygonStrings = coordinateString.split('), (');

    const polygons: [number, number][][] = [];

    for (const polygonString of polygonStrings) {
      const coordPairs = polygonString
        .replace(/[()]/g, '')
        .split(',')
        .map(pair => pair.trim())
        .filter(pair => pair.length > 0);

      const coordinates: [number, number][] = [];
      for (const pair of coordPairs) {
        const [lon, lat] = pair.split(/\s+/).map(Number);
        if (!isNaN(lon) && !isNaN(lat)) {
          coordinates.push([lat, lon]); // Leaflet expects [lat, lon]
        }
      }

      if (coordinates.length > 0) {
        polygons.push(coordinates);
      }
    }

    return polygons;
  } catch (error) {
    console.error('Error parsing WKT coordinates:', error);
    return [];
  }
}

// Function to process Excel data from GeoJSON
function processExcelData(raw: any[] | { features: any[] }): ParsedExcelData[] {
  const features = Array.isArray(raw) ? raw : raw.features;
  if (!Array.isArray(features)) return [];
  return features.map((props: any) => {
    const coords = parseWKTCoordinates(props["Координаты"] || "");
    return {
      id: `excel-${props["№\nп.п."]}`,
      depositName: (props["\nНаименование месторождения, место расположения\n"] || '').trim(),
      bin: (props["БИН"] || '').trim(),
      minerals: (props["Полезные ископаемые (запасы, годовой объем добычи)"] || '').trim(),
      workType: (props["Вид проводимых работ"] || '').trim(),
      company: (props["Информация по недропользователю (наименование, место регестрации)"] || '').trim(),
      contractInfo: (props["Информация по контракту/лицензии (номер, дата и срок действия)"] || '').trim(),
      coordinates: coords,
      group: (props["Район"] || '').trim(),
    };
  });
}

// Helper to get unique regions from Excel data
function getExcelRegions(data: ParsedExcelData[]): string[] {
  const regions = new Set<string>();
  for (const item of data) {
    if (item.group) regions.add(item.group.trim());
  }
  return Array.from(regions).sort();
}

export default function MapPage() {
  // All state must be declared before using in filteredExcelData
  const mapRef = useRef<LeafletMap | null>(null);
  const [polygonCoords, setPolygonCoords] = useState<[number, number][] | null>(null);
  const [allFetchedPolygons, setAllFetchedPolygons] = useState<{
    id: string;
    coordinates: [number, number][];
    company: Company;
    data: any;
  }[]>([]);
  const [isInfoShow, setIsInfoShow] = useState<boolean>(false);
  const [data, setData] = useState<{
    id?: string;
    tparcel?: string; // тип участка (например, "горный")
    parcelarea?: string; // площадь, возможно пригодится преобразовать в number
    nlicense?: string; // номер лицензии
    "admterr_id/oblast_admterr_id/name"?: string; // название области (рус)
    "admterr_id/oblast_admterr_id/name_kk"?: string; // название области (каз)
    mineraldeveloper?: string; // недропользователь
    "admterr_id/oblast_admterr_id"?: string; // ID области
    contractend_date?: string; // дата окончания контракта (ISO строка)
    tminerals?: string; // тип полезного ископаемого
    deposit?: string; // месторождение
    parceldepth?: string; // глубина участка
    ncontract?: string; // номер контракта
    contractbegin_date?: string; // дата начала контракта
    parcel_date?: string; // дата регистрации участка
  }>();
  const [cRegion, setRegion] = useState<Region>({
    name: "",
    id: "",
    company: [],
    coordinates: [],
    url: "",
  });
  const [selectedCategoryKey, setSelectedCategoryKey] = useState<
    "TPI" | "OPI" | "default"
  >("default"); // New state for outer tabs
  const [selectedTypeKey, setSelectedTypeKey] = useState<"razvedka" | "dobycha" | "default">("default"); // New state for inner tabs
  const [currentCompany, setCurrentCompany] = useState<Company>();
  const [selectedCompanies, setSelectedCompanies] = useState<Company[]>([]);
  const [filteredCompaniesByCategory, setFilteredCompaniesByCategory] = useState<
    Company[]
  >([]); // New state to hold companies filtered by category
  const [isError, setIsError] = useState<string>('');
  const [isMapModalOpen, setIsMapModalOpen] = useState<boolean>(false);
  const [excelMiningData, setExcelMiningData] = useState<ParsedExcelData[]>([]);
  const [showExcelData, setShowExcelData] = useState<boolean>(false);
  const [selectedExcelItem, setSelectedExcelItem] = useState<ParsedExcelData | null>(null);
  const [excelRegionToShow, setExcelRegionToShow] = useState<string>('');
  const [excelRegionDataCount, setExcelRegionDataCount] = useState<number>(0);
  const [regionPolygons, setRegionPolygons] = useState<
    {
      id: string;
      name: string;
      company: Company[];
      coordinates: [number, number][]; // [lat, lon]
      url?: string;
    }[]
  >([]);

  // Helper: get unique regions for dropdown and filter Excel data for the selected region or show all
  const excelRegions = getExcelRegions(excelMiningData);
  const filteredExcelData = (!showExcelData)
    ? []
    : (excelRegionToShow === '__all__')
      ? excelMiningData
      : (excelRegionToShow)
        ? excelMiningData.filter(item => item.group === excelRegionToShow)
        : [];

  // Draw Excel polygons on map when filteredExcelData or showExcelData changes
  // Draw Excel polygons on map when filteredExcelData or showExcelData changes
  // This must come after all state declarations
  // We must use a function declaration for getFilteredExcelData and filteredExcelData
  // so that showExcelData is always declared before this effect
  useEffect(() => {
    if (!showExcelData || !filteredExcelData.length || !mapRef.current) {
      return;
    }

    // 1. Remove old Excel polygons (but not basemap tiles)
    mapRef.current.eachLayer(layer => {
      // Only remove layers that are polygons (skip basemap, controls, etc.)
      if ((layer as any)._latlngs) {
        mapRef.current!.removeLayer(layer);
      }
    });

    // 2. Build a fresh group
    const excelGroup = new L.FeatureGroup();
    filteredExcelData.forEach(item => {
      item.coordinates.forEach((ring, idx) => {
        const polygon = L.polygon(ring);
        polygon.on('click', () => {
          setSelectedExcelItem(item);
          setIsInfoShow(false); // Hide API info if open
        });
        excelGroup.addLayer(polygon);
      });
    });

    // 3. Add to map & zoom
    excelGroup.addTo(mapRef.current);
    mapRef.current.fitBounds(excelGroup.getBounds(), { padding: [20, 20] });
  }, [showExcelData, filteredExcelData]);
  // Process Excel data on component mount
  useEffect(() => {
    const processed = processExcelData(excelData);
    setExcelMiningData(processed);
    setShowExcelData(true); // Show Excel data by default so polygons render
  }, []);

  useEffect(() => {
    setData({});
    setIsInfoShow(false);
  }, [selectedCompanies]);

  const handleCompanySelect = (companyData: Company[]) => {
    setSelectedCompanies(companyData);
  };

  useEffect(() => {
    const fn2 = async () => {
      const res = await fetch("https://map.choices.kz/api/get_area.php");
      const resData = await res.json();
      if (resData?.features) {
        const features: Feature<Polygon>[] = resData.features;
        const polygons = features
          .filter((feature) => (feature as any)?.region?.coordinates?.[0]?.[0])
          .map((feature, i) => {
            const rawCoords = (feature as any).region
              .coordinates[0][0] as number[][];
            const coords = rawCoords.map(
              (coord) => [coord[1], coord[0]] as [number, number],
            );
            return {
              id: `region-${i}`,
              name: (feature as any).properties?.name,
              url: (feature as any).url,
              company: (feature as any).company,
              coordinates: coords,
            };
          });
        setRegionPolygons(polygons);
      }
    };
    fn2();
  }, []);

  const handleFocus = async (location: string, company: Company) => {
    const res = await fetch(
      "https://map.choices.kz/api/info.php?location=" + location,
    );
    const data = await res.json();
    if (await data.error) {
      setIsInfoShow(false);
      setIsError('Информация не найдена');
      return;
    }
    setIsError('');
    setData(await data);
    setIsInfoShow(true);
    const rawPolygon = data.coordinates?.[0]?.[0];
    if (!rawPolygon) return;
    const polygon = rawPolygon.map(([lon, lat]: [number, number]) => [
      lat,
      lon,
    ]); // 🔄 меняем порядок

    // Add to all fetched polygons array
    const newPolygon = {
      id: `${company.company_title}-${location}`,
      coordinates: polygon,
      company: company,
      data: data
    };

    setAllFetchedPolygons(prev => {
      // Check if this polygon already exists
      const existsIndex = prev.findIndex(p => p.id === newPolygon.id);
      if (existsIndex !== -1) {
        // Update existing polygon
        const updated = [...prev];
        updated[existsIndex] = newPolygon;
        return updated;
      } else {
        // Add new polygon
        return [...prev, newPolygon];
      }
    });

    setTimeout(() => {
      setPolygonCoords(polygon);
    }, 1300);
    if (mapRef.current) {
      const center = L.polygon(polygon).getBounds().getCenter();
      mapRef.current.flyTo(center, 15, { animate: true, duration: 1 });
    }
  };

  const loadAllCoordinates = async (companies: Company[]) => {
    setIsError('');
    const newPolygons: typeof allFetchedPolygons = [];

    for (const company of companies) {
      try {
        const res = await fetch(
          "https://map.choices.kz/api/info.php?location=" + company.location,
        );
        const data = await res.json();

        if (!data.error && data.coordinates?.[0]?.[0]) {
          const rawPolygon = data.coordinates[0][0];
          const polygon = rawPolygon.map(([lon, lat]: [number, number]) => [
            lat,
            lon,
          ]);

          newPolygons.push({
            id: `${company.company_title}-${company.location}`,
            coordinates: polygon,
            company: company,
            data: data
          });
        }
      } catch (error) {
        console.error(`Error fetching coordinates for ${company.company_title}:`, error);
      }
    }

    setAllFetchedPolygons(prev => {
      const combined = [...prev];
      newPolygons.forEach(newPolygon => {
        const existsIndex = combined.findIndex(p => p.id === newPolygon.id);
        if (existsIndex !== -1) {
          combined[existsIndex] = newPolygon;
        } else {
          combined.push(newPolygon);
        }
      });
      return combined;
    });

    // Fit map to show all polygons
    if (newPolygons.length > 0 && mapRef.current) {
      const group = new L.FeatureGroup();
      newPolygons.forEach(polygon => {
        group.addLayer(L.polygon(polygon.coordinates));
      });
      mapRef.current.fitBounds(group.getBounds(), { padding: [20, 20] });
    }
  };

  const handleRegionSelect = (region: Region) => {
    setRegion(region);
    if (region.name) {
      const regionExcelData = excelMiningData.filter(item => item.group === region.name);
      setExcelRegionToShow(region.name);
      setExcelRegionDataCount(regionExcelData.length);
    } else {
      setExcelRegionToShow('');
      setExcelRegionDataCount(0);
    }
    // Automatically load coordinates for all companies in the region
    if (region.company && region.company.length > 0) {
      loadAllCoordinates(region.company);
    }
  };

  const handleExcelItemSelect = (excelItem: ParsedExcelData, polygonIndex: number) => {
    setSelectedExcelItem(excelItem);
    setIsInfoShow(false); // Hide API data info

    // Focus on the selected polygon
    if (excelItem.coordinates[polygonIndex] && mapRef.current) {
      const center = L.polygon(excelItem.coordinates[polygonIndex]).getBounds().getCenter();
      mapRef.current.flyTo(center, 12, { animate: true, duration: 1 });
    }
  };

  // Get unique regions for dropdown
  // Remove duplicate excelRegions declaration

  // Filter Excel data for the selected region or show all

  const mapViewProps = { // Collect all props for MapView here
    mapRef,
    polygonCoords,
    regionPolygons,
    allFetchedPolygons,
    excelMiningData: filteredExcelData,
    showExcelData,
    onExcelItemSelect: handleExcelItemSelect,
    getCompany: handleCompanySelect,
    setRegion: handleRegionSelect,
    currentCompany,
  };

  return (
    <DefaultLayout>
      <div className="flex w-full h-full">
        <div className="w-full h-full flex flex-col">
          {!isMapModalOpen && <MapView {...mapViewProps} />}
          {isError !== '' && <div className="flex flex-col bg-red-100 p-2 px-4 rounded-xl mt-2">
            <h2 className="text-red-800 text-sm">Ошибка</h2>
            <p className="text-red-700 text-sm">{isError}</p>
          </div>}
          {isInfoShow && (
            <div className="grid grid-cols-3 gap-3 bg-[#f4f4f5] dark:bg-[#18181b] rounded-2xl p-4 h-[300px] overflow-y-auto my-2 border-1 dark:border-gray-800">
              <div className="w-full col-span-3 flex justify-end">
                <button
                  onClick={() => {
                    setIsInfoShow(false);
                  }}
                >
                  <X size={20} className="text-gray-600 dark:text-gray-400" />
                </button>
              </div>
              <div className="">
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Область
                </p>
                <h4>{data?.["admterr_id/oblast_admterr_id/name"]}</h4>
              </div>
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Месторождение
                </p>
                <h4>{data?.deposit}</h4>
              </div>
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Номер контракта/лицензии
                </p>
                <h4>{data?.nlicense}</h4>
              </div>
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Площадь отвода (км2)
                </p>
                <h4>{data?.parcelarea}</h4>
              </div>
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Недропользователь
                </p>
                <h4>{data?.mineraldeveloper}</h4>
              </div>
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Номер контракта/лицензии
                </p>
                <h4>{data?.ncontract}</h4>
              </div>
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Дата выдачи контракта/лицензии
                </p>
                <h4>{data?.contractbegin_date}</h4>
              </div>
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Срок действия контракта/лицензии
                </p>
                <h4>{data?.contractend_date}</h4>
              </div>
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Отвод</p>
                <h4>{data?.tparcel}</h4>
              </div>
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Полезные ископаемые
                </p>
                <h4>{data?.tminerals}</h4>
              </div>
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Глубина отвода (м)
                </p>
                <h4>{data?.parceldepth}</h4>
              </div>
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Дата выдачи отвода
                </p>
                <h4>{data?.parcel_date}</h4>
              </div>
            </div>
          )}
          {selectedExcelItem && (
            <div className="grid grid-cols-2 gap-3 bg-purple-50 dark:bg-purple-900/20 rounded-2xl p-4 h-[300px] overflow-y-auto my-2 border-1 border-purple-200 dark:border-purple-700">
              <div className="w-full col-span-2 flex justify-between items-center">
                <h3 className="text-purple-700 dark:text-purple-300 font-bold">📊 Excel Data</h3>
                <button
                  onClick={() => {
                    setSelectedExcelItem(null);
                  }}
                >
                  <X size={20} className="text-gray-600 dark:text-gray-400" />
                </button>
              </div>
              <div className="col-span-2">
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Наименование месторождения
                </p>
                <h4 className="font-semibold">{selectedExcelItem.depositName}</h4>
              </div>
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Группа ПИ
                </p>
                <h4>{selectedExcelItem.group}</h4>
              </div>
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  БИН
                </p>
                <h4>{selectedExcelItem.bin}</h4>
              </div>
              <div className="col-span-2">
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Полезные ископаемые
                </p>
                <h4>{selectedExcelItem.minerals}</h4>
              </div>
              <div className="col-span-2">
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Вид проводимых работ
                </p>
                <h4>{selectedExcelItem.workType}</h4>
              </div>
              <div className="col-span-2">
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Недропользователь
                </p>
                <h4>{selectedExcelItem.company}</h4>
              </div>
              <div className="col-span-2">
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Информация по контракту/лицензии
                </p>
                <h4>{selectedExcelItem.contractInfo}</h4>
              </div>
            </div>
          )}
        </div>
        <div className="max-w-[330px] w-full h-full bg-white dark:bg-black px-3 py-1 overflow-y-auto">
          <button
            onClick={() => setIsMapModalOpen(true)}
            className="w-full mb-2 text-white text-sm flex items-center justify-center gap-1.5 bg-primary-500 dark:bg-primary-400 p-2 px-3 rounded-xl hover:bg-primary-400 dark:hover:bg-primary-300"
            aria-label="Открыть карту на полный экран"
          >
            <Expand size={16} />
            <span>Открыть карту на полный экран</span>
          </button>

          {/* Button to show Excel data for selected region */}
          {excelRegionToShow && excelRegionDataCount > 0 && !showExcelData && (
            <button
              onClick={() => setShowExcelData(true)}
              className="w-full mb-2 text-white text-sm flex items-center justify-center gap-1.5 bg-purple-500 hover:bg-purple-600 p-2 px-3 rounded-xl"
            >
              📊 Показать данные региона ({excelRegionDataCount})
            </button>
          )}
          {/* Button to hide Excel data */}
          {showExcelData && (
            <button
              onClick={() => {
                setShowExcelData(false);
                setExcelRegionToShow('');
              }}
              className="w-full mb-2 text-white text-sm flex items-center justify-center gap-1.5 bg-purple-600 hover:bg-purple-700 p-2 px-3 rounded-xl"
            >
              Скрыть данные Excel
            </button>
          )}

          {/* Excel region filter dropdown */}
          {showExcelData && excelRegions.length > 0 && (
            <div className="mb-4">
              <label className="block text-xs font-semibold text-purple-700 dark:text-purple-300 mb-2">Регион Excel данных</label>
              <div className="relative w-full">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
                  {/* Region SVG icon */}
                  <svg width="18" height="18" fill="none" viewBox="0 0 24 24" className="text-purple-500 dark:text-purple-300"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" /><path d="M12 7v5l3 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </span>
                <select
                  value={excelRegionToShow}
                  onChange={e => setExcelRegionToShow(e.target.value)}
                  className="w-full pl-10 pr-10 py-2 rounded-xl border border-purple-300 dark:border-purple-700 bg-white dark:bg-gray-900 text-sm text-gray-700 dark:text-gray-200 shadow focus:outline-none focus:ring-2 focus:ring-purple-400 hover:border-purple-500 transition-all appearance-none"
                  style={{
                    backgroundImage:
                      'url("data:image/svg+xml,%3Csvg width=\'16\' height=\'16\' fill=\'none\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cpath d=\'M4 6l4 4 4-4\' stroke=\'%239C27B0\' stroke-width=\'2\' stroke-linecap=\'round\' stroke-linejoin=\'round\'/%3E%3C/svg%3E")',
                    backgroundRepeat: 'no-repeat',
                    backgroundPosition: 'right 0.75rem center',
                    backgroundSize: '1.2em',
                  }}
                >
                  <option value="">Выберите регион</option>
                  <option value="__all__">Все регионы (показать все)</option>
                  {excelRegions.map(region => (
                    <option key={region} value={region}>{region}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          <h2 className="text-sm text-gray-600 dark:text-gray-300 mb-2">
            Информация о {cRegion.name}:
          </h2>
          {allFetchedPolygons.length > 0 && (
            <div className="mb-2 p-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
              <p className="text-xs text-blue-700 dark:text-blue-300">
                Отображено координат: {allFetchedPolygons.length}
              </p>
            </div>
          )}
          {showExcelData && excelMiningData.length > 0 && (
            <div className="mb-2 p-2 bg-purple-50 dark:bg-purple-900/20 rounded-lg">
              <p className="text-xs text-purple-700 dark:text-purple-300">
                📊 Excel данные: {excelMiningData.length} записей
              </p>
            </div>
          )}
          {cRegion.name && cRegion.company.length > 0 && (
            <div className="flex gap-2 mb-3">
              <button
                onClick={() => loadAllCoordinates(cRegion.company)}
                className="flex-1 text-white text-sm bg-green-500 hover:bg-green-600 p-2 px-3 rounded-xl"
              >
                Показать все координаты региона ({cRegion.company.length})
              </button>
              {allFetchedPolygons.length > 0 && (
                <button
                  onClick={() => setAllFetchedPolygons([])}
                  className="text-white text-sm bg-red-500 hover:bg-red-600 p-2 px-3 rounded-xl"
                >
                  Очистить
                </button>
              )}
            </div>
          )}

          {/* Excel Data Control */}
          <div className="flex gap-2 mb-3">
            <button
              onClick={() => setShowExcelData(!showExcelData)}
              className={`flex-1 text-white text-sm p-2 px-3 rounded-xl ${showExcelData
                ? 'bg-purple-600 hover:bg-purple-700'
                : 'bg-purple-500 hover:bg-purple-600'
                }`}
            >
              {showExcelData ? 'Скрыть' : 'Показать'} данные Excel ({excelMiningData.length})
            </button>
            {showExcelData && (
              <button
                onClick={() => {
                  if (excelMiningData.length > 0 && mapRef.current) {
                    const group = new L.FeatureGroup();
                    excelMiningData.forEach(item => {
                      item.coordinates.forEach(polygonCoords => {
                        group.addLayer(L.polygon(polygonCoords));
                      });
                    });
                    mapRef.current.fitBounds(group.getBounds(), { padding: [20, 20] });
                  }
                }}
                className="text-white text-sm bg-purple-600 hover:bg-purple-700 p-2 px-3 rounded-xl"
              >
                Центрировать
              </button>
            )}
          </div>
          {cRegion.url != "" && (
            <img
              src={cRegion.url}
              className="rounded-xl mb-2"
              width={"100%"}
              height={100}
            />
          )}
          <Table>
            <TableHeader>
              <TableColumn>Недропользователей</TableColumn>
              <TableColumn>ТПИ</TableColumn>
              <TableColumn>ОПИ</TableColumn>
            </TableHeader>
            <TableBody>
              <TableRow key="1">
                <TableCell>{countUniqueCompanyTitles(cRegion)}</TableCell>
                <TableCell>{countUniqueOPIandTPI(cRegion).ТПИ}</TableCell>
                <TableCell>{countUniqueOPIandTPI(cRegion).ОПИ}</TableCell>
              </TableRow>
            </TableBody>
          </Table>

          {/* Outer Tabs for TPI/OPI */}
          <Tabs
            aria-label="Category Options"
            selectedKey={selectedCategoryKey}
            onSelectionChange={(key) => {
              setSelectedCategoryKey(key as "TPI" | "OPI" | "default");
              setSelectedTypeKey("default"); // Reset inner tab when outer tab changes
              let companiesToFilter: Company[] = [];
              if (key === "TPI") {
                companiesToFilter = filterCompaniesByCategory(cRegion, "ТПИ");
              } else if (key === "OPI") {
                companiesToFilter = filterCompaniesByCategory(cRegion, "ОПИ");
              }
              setFilteredCompaniesByCategory(companiesToFilter);
              handleCompanySelect([]); // Clear selected companies when category changes

              // Automatically load coordinates for the filtered companies
              if (companiesToFilter.length > 0) {
                loadAllCoordinates(companiesToFilter);
              }
            }}
            className="mt-4 mb-2"
          >
            <Tab key="TPI" title={`ТПИ: ${countUniqueOPIandTPI(cRegion).ТПИ}`} />
            <Tab key="OPI" title={`ОПИ: ${countUniqueOPIandTPI(cRegion).ОПИ}`} />
          </Tabs>

          {/* Inner Tabs for Разведка/Добыча */}
          {selectedCategoryKey !== "default" && (
            <>
              <Tabs
                aria-label="Type Options"
                selectedKey={selectedTypeKey}
                onSelectionChange={(key) => {
                  setSelectedTypeKey(key as "razvedka" | "dobycha" | "default");
                  let selectedCompanies: Company[] = [];
                  if (key === "razvedka") {
                    selectedCompanies = filterCompaniesByType(filteredCompaniesByCategory, "разведка");
                    handleCompanySelect(selectedCompanies);
                  } else if (key === "dobycha") {
                    selectedCompanies = filterCompaniesByType(filteredCompaniesByCategory, "добыча");
                    handleCompanySelect(selectedCompanies);
                  }

                  // Automatically load coordinates for the selected type
                  if (selectedCompanies.length > 0) {
                    loadAllCoordinates(selectedCompanies);
                  }
                }}
                className="mt-2 mb-2"
              >
                <Tab
                  key="razvedka"
                  title={`Разведки: ${countCompanyTypes(filteredCompaniesByCategory).разведка}`}
                />
                <Tab
                  key="dobycha"
                  title={`Добычи: ${countCompanyTypes(filteredCompaniesByCategory).добыча}`}
                />
              </Tabs>

              {/* Button to load all coordinates */}
              {filteredCompaniesByCategory.length > 0 && (
                <div className="flex gap-2 mb-3">
                  <button
                    onClick={() => loadAllCoordinates(filteredCompaniesByCategory)}
                    className="flex-1 text-white text-sm bg-blue-500 hover:bg-blue-600 p-2 px-3 rounded-xl"
                  >
                    Показать все ({filteredCompaniesByCategory.length})
                  </button>
                  {allFetchedPolygons.length > 0 && (
                    <button
                      onClick={() => setAllFetchedPolygons([])}
                      className="text-white text-sm bg-red-500 hover:bg-red-600 p-2 px-3 rounded-xl"
                    >
                      Очистить
                    </button>
                  )}
                </div>
              )}
            </>
          )}

          {/* Display companies based on selected inner tab */}
          {selectedTypeKey !== "default" ? (
            <div className="flex flex-col gap-3">
              {selectedCompanies?.map((e, index) => (
                <button
                  key={index}
                  onClick={() => {
                    handleFocus(e.location, e);
                    setCurrentCompany(e);
                  }}
                  color="primary"
                  className="w-full text-sm text-gray-700 dark:text-gray-300 text-left"
                >
                  {index + 1}. {e.company_title}
                </button>
              ))}
            </div>
          ) : (
            selectedCategoryKey !== "default" && (
              <p className="w-full text-xs text-gray-500 text-center mt-3">
                Нажмите разведки/добычи чтобы увидеть недропользователей
              </p>
            )
          )}

          {selectedCategoryKey === "default" && (
            <p className="w-full text-xs text-gray-500 text-center mt-3">
              Выберите ТПИ или ОПИ для фильтрации недропользователей
            </p>
          )}
        </div>
      </div>
      <MapModal
        isOpen={isMapModalOpen}
        onClose={() => setIsMapModalOpen(false)}
        mapViewProps={mapViewProps}
      />
    </DefaultLayout>
  );
}