// Ciudades colombianas disponibles para el campo "Ciudad" de un lead, con
// sus coordenadas aproximadas (para el mapa del Dashboard). Es una lista
// fija a propósito -- así el nombre siempre coincide con una coordenada
// conocida y el mapa nunca tiene "huérfanos" sin dónde ubicarse.
export const COLOMBIA_CITIES = [
  { name: 'Bogotá', lat: 4.7110, lng: -74.0721 },
  { name: 'Medellín', lat: 6.2442, lng: -75.5812 },
  { name: 'Cali', lat: 3.4516, lng: -76.5320 },
  { name: 'Barranquilla', lat: 10.9685, lng: -74.7813 },
  { name: 'Cartagena', lat: 10.3910, lng: -75.4794 },
  { name: 'Cúcuta', lat: 7.8939, lng: -72.5078 },
  { name: 'Bucaramanga', lat: 7.1193, lng: -73.1227 },
  { name: 'Pereira', lat: 4.8087, lng: -75.6906 },
  { name: 'Santa Marta', lat: 11.2408, lng: -74.1990 },
  { name: 'Ibagué', lat: 4.4389, lng: -75.2322 },
  { name: 'Pasto', lat: 1.2136, lng: -77.2811 },
  { name: 'Manizales', lat: 5.0703, lng: -75.5138 },
  { name: 'Neiva', lat: 2.9273, lng: -75.2819 },
  { name: 'Villavicencio', lat: 4.1420, lng: -73.6266 },
  { name: 'Armenia', lat: 4.5339, lng: -75.6811 },
  { name: 'Valledupar', lat: 10.4631, lng: -73.2532 },
  { name: 'Montería', lat: 8.7479, lng: -75.8814 },
  { name: 'Sincelejo', lat: 9.3047, lng: -75.3978 },
  { name: 'Popayán', lat: 2.4448, lng: -76.6147 },
  { name: 'Tunja', lat: 5.5353, lng: -73.3678 },
  { name: 'Riohacha', lat: 11.5444, lng: -72.9072 },
  { name: 'Quibdó', lat: 5.6947, lng: -76.6583 },
  { name: 'Florencia', lat: 1.6144, lng: -75.6062 },
  { name: 'Yopal', lat: 5.3378, lng: -72.3959 },
];

export const COLOMBIA_CITY_NAMES = COLOMBIA_CITIES.map((c) => c.name);

// Caja delimitadora aproximada de Colombia continental, usada para proyectar
// lat/lng a coordenadas del mapa (ver components/colombiaMap.js).
export const COLOMBIA_BOUNDS = { latMin: -4.35, latMax: 12.6, lngMin: -79.1, lngMax: -66.8 };

// Contorno simplificado de Colombia continental (sin San Andrés/Providencia),
// como pares [lat, lng] en orden de recorrido, para dibujar la silueta del
// país detrás de los marcadores en el mapa del Dashboard. Simplificado a
// partir de datos de fronteras públicos (~100 puntos) -- suficiente para un
// croquis reconocible, no para precisión cartográfica.
export const COLOMBIA_OUTLINE = [
  [-0.152, -75.3732], [0.0848, -75.8015], [0.416, -76.2923], [0.2569, -76.5764],
  [0.3957, -77.425], [0.8259, -77.6686], [0.8099, -77.8551], [1.3809, -78.8553],
  [1.6914, -78.9909], [1.7664, -78.6178], [2.2674, -78.6621], [2.6296, -78.4276],
  [2.6966, -77.9315], [3.325, -77.5104], [3.8496, -77.1277], [4.0876, -77.4963],
  [4.668, -77.3076], [5.5828, -77.5332], [5.8454, -77.3188], [6.6911, -77.4767],
  [7.2238, -77.8816], [7.7098, -77.7534], [7.6381, -77.4311], [7.9353, -77.2426],
  [8.5243, -77.4747], [8.6705, -77.3534], [8.6387, -76.8367], [9.3368, -76.0864],
  [9.4432, -75.6746], [9.774, -75.6647], [10.619, -75.4804], [11.083, -74.9069],
  [11.102, -74.2768], [11.3105, -74.1972], [11.227, -73.4148], [11.732, -72.6278],
  [11.9556, -72.2382], [12.4373, -71.7541], [12.376, -71.3998], [12.113, -71.1375],
  [11.7763, -71.3316], [11.6087, -71.9739], [11.1087, -72.2276], [10.822, -72.6147],
  [10.4503, -72.9053], [9.7368, -73.0276], [9.152, -73.305], [9.085, -72.7887],
  [8.6253, -72.6605], [8.4053, -72.4399], [8.0026, -72.3609], [7.6325, -72.4797],
  [7.4238, -72.4445], [7.3404, -72.1984], [6.9916, -71.9602], [7.0878, -70.6742],
  [6.9604, -70.0933], [6.0999, -69.3895], [6.2068, -68.9853], [6.1533, -68.2651],
  [6.2673, -67.6951], [6.0955, -67.3414], [5.5569, -67.5215], [5.2211, -67.7447],
  [4.5039, -67.823], [3.8395, -67.6218], [3.5423, -67.3376], [3.3185, -67.3032],
  [2.8207, -67.8099], [2.6003, -67.4471], [2.2506, -67.1813], [1.2534, -66.8763],
  [1.1301, -67.065], [1.72, -67.26], [2.0372, -67.5378], [1.6925, -67.8686],
  [1.7148, -69.817], [1.0891, -69.8046], [0.9857, -69.2186], [0.6027, -69.2524],
  [0.7062, -69.4524], [0.5414, -70.0156], [-0.1852, -70.0207], [-0.55, -69.5771],
  [-1.1226, -69.4205], [-1.5563, -69.4441], [-4.2982, -69.8936], [-3.7666, -70.394],
  [-3.7429, -70.6927], [-2.7252, -70.0477], [-2.2569, -70.8135], [-2.3428, -71.4136],
  [-2.1698, -71.7748], [-2.4342, -72.3258], [-2.309, -73.0704], [-1.2605, -73.6595],
  [-1.0028, -74.1224], [-0.5308, -74.4416], [-0.0572, -75.1066], [-0.152, -75.3732],
];

export function findCity(name) {
  return COLOMBIA_CITIES.find((c) => c.name === name) || null;
}
