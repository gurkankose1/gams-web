import { Flight, MaintenanceBlock } from '../types.ts';
import { CONCOURSE_LAYOUT, WIDE_BODY_AIRCRAFT } from '../constants.ts';
import {
    isContactStand,
    isStandWidebodyCompatible,
    isStandCatFCompatible,
    getAircraftCategory
} from './ams-rules.ts';
import {
    isFlightBridgeEligible,
    buildStandTopology,
    canFitOnStand,
    hasMaintenanceConflict,
    StandSchedule
} from './ai-allocator.ts';

export const STORAGE_KEY_API = 'gams_gemini_api_key';
export const STORAGE_KEY_MODEL = 'gams_gemini_model';
export const DEFAULT_API_KEY = '';
export const DEFAULT_MODEL = 'gemini-3.6-flash';

export const AVAILABLE_MODELS = [
    { id: 'gemini-3.6-flash', name: 'Gemini 3.6 Flash (Önerilen - Hızlı & Zeki Düşünce)', recommended: true },
    { id: 'gemini-3.5-flash', name: 'Gemini 3.5 Flash (Yüksek Kararlılık)', recommended: false },
    { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash (Deneysel Derin Akıl Yürütme)', recommended: false },
    { id: 'gemini-flash-lite-latest', name: 'Gemini Flash Lite (Ultra Hızlı)', recommended: false },
];

export function getStoredApiKey(): string {
    const key = localStorage.getItem(STORAGE_KEY_API);
    return (key && key.trim()) || '';
}

export function setStoredApiKey(key: string): void {
    localStorage.setItem(STORAGE_KEY_API, key.trim());
}

export function getStoredModel(): string {
    return localStorage.getItem(STORAGE_KEY_MODEL) || DEFAULT_MODEL;
}

export function setStoredModel(model: string): void {
    localStorage.setItem(STORAGE_KEY_MODEL, model);
}

export interface ConnectionTestResult {
    success: boolean;
    model: string;
    latencyMs: number;
    reply?: string;
    error?: string;
}

/**
 * Tests the Gemini API connection with the provided or stored key and model.
 */
export async function testGeminiConnection(apiKey?: string, modelId?: string): Promise<ConnectionTestResult> {
    const key = (apiKey || getStoredApiKey()).trim();
    const model = modelId || getStoredModel();
    const startTime = performance.now();

    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
        const payload = {
            contents: [
                {
                    parts: [
                        { text: 'Sen GAMS Apron ve Körük Planlama sistemine bağlı bir AI asistanısın. Tek bir Türkçe cümle ile bağlantının başarılı olduğunu ve hazır olduğunu bildir.' }
                    ]
                }
            ]
        };

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const latencyMs = Math.round(performance.now() - startTime);

        if (!response.ok) {
            const errBody = await response.json().catch(() => ({}));
            const errMsg = errBody.error?.message || `HTTP ${response.status} ${response.statusText}`;
            return {
                success: false,
                model,
                latencyMs,
                error: errMsg
            };
        }

        const data = await response.json();
        const reply = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || 'Bağlantı sağlandı ancak yanıt metni alınamadı.';

        return {
            success: true,
            model,
            latencyMs,
            reply
        };
    } catch (err: any) {
        return {
            success: false,
            model,
            latencyMs: Math.round(performance.now() - startTime),
            error: err.message || 'Ağ hatası veya bağlantı zaman aşımı.'
        };
    }
}

// ---------------------------------------------------------------------------
// Deep Thinking Optimization Interfaces
// ---------------------------------------------------------------------------

export interface DeepThinkingSwap {
    id: string;
    flightId: string;
    callsign: string;
    aircraftType: string;
    isWideBody: boolean;
    fromStand: string;
    toStand: string;
    strategyType: 'WIDEBODY_ELEVATION' | 'MARS_OPTIMIZATION' | 'GAP_FILL' | 'STRATEGIC_SWAP';
    reason: string;
    ruleCompliant: boolean;
    rejectionReason?: string;
    estimatedPaxGain: number;
    arrivalFormatted: string;
    departureFormatted: string;
}

export interface DeepThinkingResult {
    executiveSummary: string;
    reasoningThoughts: string[];
    swaps: DeepThinkingSwap[];
    initialBridgeRate: number;
    projectedBridgeRate: number;
    netBridgeGainCount: number;
    modelUsed: string;
}

export const getCallsign = (f: Flight): string => {
    return f.departureFlightNumber || f.arrivalFlightNumber || (f.airline ? `${f.airline} Flight` : 'FLIGHT');
};

const formatHHMM = (d: Date): string => {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

const getDurationMins = (f: Flight): number => {
    return Math.max(30, (f.scheduledDeparture.getTime() - f.scheduledArrival.getTime()) / (60 * 1000));
};

const isWide = (f: Flight): boolean => {
    if (f.acCategory === 'E' || f.acCategory === 'D' || f.acCategory === 'F') return true;
    const cat = getAircraftCategory(f.aircraftType);
    if (cat === 'E' || cat === 'D' || cat === 'F') return true;
    const cleanType = (f.aircraftType || '').toUpperCase().trim();
    return WIDE_BODY_AIRCRAFT.has(cleanType);
};

const isHeavy = (f: Flight): boolean => {
    return f.acCategory === 'F' || getAircraftCategory(f.aircraftType) === 'F';
};

/**
 * Extracts high-leverage bottlenecks for Gemini to solve:
 * 1. Widebodies assigned to remote apron.
 * 2. Contact stands with idle gaps or sub-optimally assigned short flights.
 */
export function extractApronBottlenecks(flights: Flight[], maintenanceBlocks?: MaintenanceBlock[]) {
    const topology = buildStandTopology(maintenanceBlocks);

    // Populate intervals with currently parked flights
    flights.forEach(f => {
        if (!f.parkingPosition) return;
        const sched = topology.get(f.parkingPosition);
        if (sched) {
            sched.intervals.push({
                start: f.scheduledArrival.getTime(),
                end: f.scheduledDeparture.getTime(),
                flightId: f.id
            });
        }
    });

    // Remote passenger flights (bridge eligible)
    const remoteBridgeEligible = flights.filter(f => {
        if (!isFlightBridgeEligible(f)) return false;
        if (!f.parkingPosition) return true;
        return !isContactStand(f.parkingPosition);
    });

    // Sort: Widebodies first, then by duration descending
    remoteBridgeEligible.sort((a, b) => {
        const aW = isWide(a) ? 1 : 0;
        const bW = isWide(b) ? 1 : 0;
        if (aW !== bW) return bW - aW;
        return getDurationMins(b) - getDurationMins(a);
    });

    const remoteWidebodies = remoteBridgeEligible.filter(isWide).slice(0, 15);
    const remoteNarrowbodies = remoteBridgeEligible.filter(f => !isWide(f)).slice(0, 20);

    // Identify Contact Stand Availability and Gaps
    const contactStandsSummary: Array<{
        stand: string;
        concourse: string;
        isWideCompatible: boolean;
        assignedCount: number;
        idleGaps: Array<{ start: string; end: string; durationMins: number }>;
    }> = [];

    topology.forEach((sched, stand) => {
        if (!isContactStand(stand)) return;
        const gaps: Array<{ start: string; end: string; durationMins: number }> = [];

        // Sort intervals
        const list = [...sched.intervals].sort((a, b) => a.start - b.start);
        for (let i = 0; i < list.length - 1; i++) {
            const gapMins = (list[i + 1].start - list[i].end) / (60 * 1000);
            if (gapMins >= 60) {
                gaps.push({
                    start: formatHHMM(new Date(list[i].end)),
                    end: formatHHMM(new Date(list[i + 1].start)),
                    durationMins: Math.round(gapMins)
                });
            }
        }

        contactStandsSummary.push({
            stand,
            concourse: sched.concourse,
            isWideCompatible: sched.isWideCompatible,
            assignedCount: sched.intervals.length,
            idleGaps: gaps.slice(0, 3)
        });
    });

    return {
        remoteWidebodies,
        remoteNarrowbodies,
        contactStandsSummary: contactStandsSummary.filter(s => s.idleGaps.length > 0).slice(0, 30),
        topology
    };
}

/**
 * Runs the Gemini Deep Thinking Optimization Engine.
 */
export async function runGeminiDeepThinkingOptimization(
    flights: Flight[],
    maintenanceBlocks?: MaintenanceBlock[],
    onProgress?: (message: string) => void
): Promise<DeepThinkingResult> {
    const key = getStoredApiKey();
    if (!key || key.trim() === '') {
        throw new Error('Gemini API anahtarı tanımlanmamış. Lütfen sağ üstteki "🔑 API Key" butonuna tıklayarak Google Pro anahtarınızı kaydedin.');
    }
    const model = getStoredModel();

    onProgress?.('Apron darboğazları ve açığa atılmış geniş gövdeler taranıyor...');
    const bottlenecks = extractApronBottlenecks(flights, maintenanceBlocks);

    // Compute current stats
    const eligibleFlights = flights.filter(isFlightBridgeEligible);
    const currentBridgeCount = eligibleFlights.filter(f => f.parkingPosition && isContactStand(f.parkingPosition)).length;
    const initialBridgeRate = eligibleFlights.length > 0 ? (currentBridgeCount / eligibleFlights.length) * 100 : 0;

    onProgress?.(`Gemini ${model} derin akıl yürütme motoruna bağlanılıyor...`);

    // Prepare concise prompt context for Gemini
    const candidateFlightsPrompt = bottlenecks.remoteWidebodies.slice(0, 10).map(f => ({
        id: f.id,
        callsign: getCallsign(f),
        aircraft: f.aircraftType,
        isWide: true,
        arr: formatHHMM(f.scheduledArrival),
        dep: formatHHMM(f.scheduledDeparture),
        durMins: Math.round(getDurationMins(f)),
        currentStand: f.parkingPosition || 'REMOTE',
        domestic: Boolean((f.arrivalIsDomestic ?? f.isDomestic) && (f.departureIsDomestic ?? f.isDomestic))
    }));

    const standGapsPrompt = bottlenecks.contactStandsSummary.slice(0, 20).map(s => ({
        stand: s.stand,
        concourse: s.concourse,
        wideFit: s.isWideCompatible,
        gaps: s.idleGaps
    }));

    const systemInstruction = `
Sen İstanbul Havalimanı (IST / LTFM) Baş Apron ve Slot Kontrol Şefisin (Chief Apron Dispatcher & Slot Optimizer).
Görevin: Klasik kuralcı algoritmaların gözden kaçırdığı sezgisel takasları (swap chains) ve stratejik hamleleri yaparak KÖRÜK KULLANIM ORANINI (% Bridge Utilization) ve YOLCU MEMNUNİYETİNİ MAKSİMİZE ETMEK.

KURALLAR VE KISITLAR:
1. Kategori F uçaklar (B748, A380) SADECE Stand A2'ye yanaşabilir.
2. Geniş Gövde (A330, A350, B777, B787) sadece 'wideFit: true' olan körüklere yanaşabilir.
3. MARS Stantları (L, R, C): Center (C) kullanılırsa L ve R kapatılır; L ve R kullanılırsa Center kapatılır.
4. İç Hat uçuşları sadece G İskelesi (Concourse G) köprülerine yanaşabilir. Dış Hat uçuşları A, B, D, F iskelelerine yanaşabilir.
5. Uçaklar arasında en az 15 dakika tampon süre olmalıdır.

Senden beklenen:
Açığa atılmış geniş gövdeleri veya yüksek yolculu uçuşları körüklere almak için stratejik takaslar (Swap) öner.
Yanıtını YALNIZCA geçerli bir JSON nesnesi olarak ver. Markdown kod bloğu (örn \`\`\`json) İÇERMESİN.

JSON Formatı:
{
  "executiveSummary": "Genel operasyonel değerlendirme ve sağlanan köprü kazancı açıklaması (Türkçe).",
  "reasoningThoughts": [
    "Düşünce adımı 1: Neden bu uçak seçildi?",
    "Düşünce adımı 2: Hangi stant boşluğu veya takas zinciri kurgulandı?",
    "Düşünce adımı 3: Kısıt ve güvenlik kontrolleri."
  ],
  "recommendedSwaps": [
    {
      "flightId": "ucus_id",
      "callsign": "TK123",
      "targetStand": "StandNo (örn: 201, 204C, A2)",
      "strategyType": "WIDEBODY_ELEVATION",
      "reason": "Bu hamlenin gerekçesi ve köprüye kazandırılan avantaj.",
      "estimatedPaxGain": 250
    }
  ]
}
`;

    const userPrompt = `
İşte mevcut durumdaki darboğazlar ve açığa park edilmiş yüksek öncelikli uçuşlar:
UÇUŞLAR:
${JSON.stringify(candidateFlightsPrompt, null, 2)}

MÜSAİT KÖRÜK ZAMAN BOŞLUKLARI (GAPS):
${JSON.stringify(standGapsPrompt, null, 2)}

Mevcut Köprü Oranı: %${initialBridgeRate.toFixed(1)}.
Lütfen körük kullanım oranını artıracak en akıllıca ve kurallara uygun 3 ila 8 adet takas önerisi kurgula.
`;

    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
        const payload = {
            systemInstruction: {
                parts: [{ text: systemInstruction }]
            },
            contents: [
                {
                    parts: [{ text: userPrompt }]
                }
            ],
            generationConfig: {
                responseMimeType: 'application/json',
                temperature: 0.2
            }
        };

        onProgress?.('Gemini stratejik takas zincirlerini derinlemesine hesaplıyor...');

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errBody = await response.json().catch(() => ({}));
            throw new Error(errBody.error?.message || `Gemini API Hatası: HTTP ${response.status}`);
        }

        const data = await response.json();
        const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '{}';

        // Parse JSON safely
        let parsed: any;
        try {
            parsed = JSON.parse(rawText);
        } catch {
            const cleanText = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
            parsed = JSON.parse(cleanText);
        }

        onProgress?.('Önerilen takaslar GAMS kural motoru ve bakım takvimi ile doğrulanıyor...');

        // Validate each recommended swap
        const validatedSwaps: DeepThinkingSwap[] = [];
        const recommendedSwaps = parsed.recommendedSwaps || [];

        for (const rawSwap of recommendedSwaps) {
            const flight = flights.find(f => f.id === rawSwap.flightId || getCallsign(f) === rawSwap.callsign);
            if (!flight) continue;

            const targetStand = String(rawSwap.targetStand).trim();
            const fromStand = flight.parkingPosition || 'REMOTE';

            // Validate against rules
            let ruleCompliant = true;
            let rejectionReason: string | undefined;

            // 1. Stand exists & physical compatibility
            const sched = bottlenecks.topology.get(targetStand);
            if (!sched) {
                ruleCompliant = false;
                rejectionReason = `Stant ${targetStand} havalimanı haritasında tanımlı değil.`;
            } else if (!isContactStand(targetStand)) {
                ruleCompliant = false;
                rejectionReason = `Hedef stant ${targetStand} körük pozisyonu değil.`;
            } else {
                const fit = canFitOnStand(
                    sched,
                    flight.scheduledArrival.getTime(),
                    flight.scheduledDeparture.getTime(),
                    isWide(flight),
                    bottlenecks.topology,
                    isHeavy(flight)
                );
                if (!fit) {
                    ruleCompliant = false;
                    rejectionReason = `${flight.aircraftType} gövde tipi stant ${targetStand} kısıtlarına sığmıyor.`;
                }
            }

            // 2. Maintenance conflict
            if (ruleCompliant && maintenanceBlocks && maintenanceBlocks.length > 0) {
                if (hasMaintenanceConflict(targetStand, flight.scheduledArrival, flight.scheduledDeparture, maintenanceBlocks)) {
                    ruleCompliant = false;
                    rejectionReason = `Stant ${targetStand} üzerinde bu saat diliminde planlı bakım bloğu var.`;
                }
            }

            // 3. Time overlap check with already placed flights on target stand
            if (ruleCompliant && sched) {
                const arrTime = flight.scheduledArrival.getTime();
                const depTime = flight.scheduledDeparture.getTime();
                const bufferMs = 15 * 60 * 1000;

                const overlap = sched.intervals.some(existing => {
                    if (existing.flightId === flight.id) return false;
                    return (arrTime < existing.end + bufferMs) && (depTime + bufferMs > existing.start);
                });

                if (overlap) {
                    ruleCompliant = false;
                    rejectionReason = `Stant ${targetStand} üzerinde başka bir uçuşla zaman çakışması tespit edildi.`;
                }
            }

            validatedSwaps.push({
                id: `gemini-swap-${flight.id}-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
                flightId: flight.id,
                callsign: getCallsign(flight),
                aircraftType: flight.aircraftType || 'A320',
                isWideBody: isWide(flight),
                fromStand,
                toStand: targetStand,
                strategyType: rawSwap.strategyType || 'WIDEBODY_ELEVATION',
                reason: rawSwap.reason || 'Körük kullanım verimliliğini artırmak amacıyla optimize edildi.',
                ruleCompliant,
                rejectionReason,
                estimatedPaxGain: rawSwap.estimatedPaxGain || (isWide(flight) ? 280 : 160),
                arrivalFormatted: formatHHMM(flight.scheduledArrival),
                departureFormatted: formatHHMM(flight.scheduledDeparture)
            });
        }

        const validCount = validatedSwaps.filter(s => s.ruleCompliant).length;
        const projectedBridgeCount = currentBridgeCount + validCount;
        const projectedBridgeRate = eligibleFlights.length > 0 ? (projectedBridgeCount / eligibleFlights.length) * 100 : initialBridgeRate;

        onProgress?.('Analiz tamamlandı!');

        return {
            executiveSummary: parsed.executiveSummary || `Gemini optimizasyonu tamamlandı. ${validCount} adet yeni körük ataması doğrulandı.`,
            reasoningThoughts: parsed.reasoningThoughts || [
                'Uçuşların yer kalış süreleri ve gövde tipleri analiz edildi.',
                'Açığa park edilmiş geniş gövdeler için müsait körük cepleri bulundu.',
                'Tüm AMS ve bakım kuralları denetlendi.'
            ],
            swaps: validatedSwaps,
            initialBridgeRate,
            projectedBridgeRate,
            netBridgeGainCount: validCount,
            modelUsed: model
        };

    } catch (err: any) {
        throw new Error(`Gemini Optimizasyon Hatası: ${err.message}`);
    }
}

/**
 * Apply selected swaps to the flight dataset.
 */
export function applyDeepThinkingSwaps(flights: Flight[], swaps: DeepThinkingSwap[]): Flight[] {
    const swapMap = new Map<string, string>();
    swaps.filter(s => s.ruleCompliant).forEach(s => {
        swapMap.set(s.flightId, s.toStand);
    });

    return flights.map(f => {
        if (swapMap.has(f.id)) {
            return {
                ...f,
                parkingPosition: swapMap.get(f.id)!
            };
        }
        return f;
    });
}
