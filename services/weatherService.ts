
export interface WeatherData {
    temp: number;
    condition: string;
    icon: string;
}

const WMO_MAP: Record<number, { icon: string; label: string }> = {
    0: { icon: '☀️', label: 'Sunny' },
    1: { icon: '🌤️', label: 'Mainly Clear' },
    2: { icon: '⛅', label: 'Partly Cloudy' },
    3: { icon: '☁️', label: 'Overcast' },
    45: { icon: '🌫️', label: 'Fog' },
    48: { icon: '🌫️', label: 'Fog' },
    51: { icon: '🌧️', label: 'Drizzle' },
    53: { icon: '🌧️', label: 'Drizzle' },
    55: { icon: '🌧️', label: 'Drizzle' },
    61: { icon: '🌧️', label: 'Rain' },
    63: { icon: '🌧️', label: 'Rain' },
    65: { icon: '🌧️', label: 'Heavy Rain' },
    71: { icon: '❄️', label: 'Snow' },
    73: { icon: '❄️', label: 'Snow' },
    75: { icon: '❄️', label: 'Heavy Snow' },
    77: { icon: '❄️', label: 'Snow Grains' },
    80: { icon: '🌧️', label: 'Showers' },
    81: { icon: '🌧️', label: 'Showers' },
    82: { icon: '🌧️', label: 'Heavy Showers' },
    85: { icon: '❄️', label: 'Snow Showers' },
    86: { icon: '❄️', label: 'Snow Showers' },
    95: { icon: '⛈️', label: 'Thunderstorm' },
    96: { icon: '⛈️', label: 'Thunderstorm' },
    99: { icon: '⛈️', label: 'Thunderstorm' },
};

export const getWeather = async (lat: number, lng: number): Promise<WeatherData> => {
    try {
        // Audit Fix: Use environment variable with fallback for external service flexibility
        const WEATHER_API_URL = (import.meta as any).env?.VITE_WEATHER_URL || 'https://api.open-meteo.com/v1/forecast';
        const response = await fetch(`${WEATHER_API_URL}?latitude=${lat}&longitude=${lng}&current_weather=true&temperature_unit=fahrenheit`);
        const data = await response.json();
        const cw = data.current_weather;
        const entry = WMO_MAP[cw.weathercode] || { icon: '🌡️', label: 'Weather' };

        return {
            temp: Math.round(cw.temperature),
            condition: entry.label,
            icon: entry.icon
        };
    } catch (e) {
        console.error("Weather Fetch Error", e);
        return { temp: 72, condition: 'Sunny', icon: '☀️' }; // Fallback
    }
};
