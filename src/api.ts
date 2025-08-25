import { SignatureGenerator } from "./algorithm";
import { DecodedMessage } from "./signature-format";
import nFetch from 'node-fetch';
import { ShazamRoot } from "./types";
import { getRandomUserAgent } from "./agents";

const TIME_ZONE = "Europe/Paris";

function uuidv4() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    }).toUpperCase();
}

export class Endpoint{
    static SCHEME = "https";
    static HOSTNAME = "amp.shazam.com";

    constructor(public timezone: string){};
    url(){
        return `${Endpoint.SCHEME}://${Endpoint.HOSTNAME}/discovery/v5/en/US/android/-/tag/${uuidv4()}/${uuidv4()}`;
    }
    params(){
        return {
            'sync': 'true',
            'webv3': 'true',
            'sampling': 'true',
            'connected': '',
            'shazamapiversion': 'v3',
            'sharehub': 'true',
            'video': 'v3'
        };
    }
    headers(){
        return {
            "X-Shazam-Platform": "IPHONE",
            "X-Shazam-AppVersion": "14.1.0",
            "Accept": "*/*",
            "Content-Type": "application/json",
            "Accept-Encoding": "gzip, deflate",
            "Accept-Language": "en",
            "User-Agent": getRandomUserAgent(),
        }
    }

    async sendRecognizeRequest(url: string, body: string){
        const fetch = global.fetch ?? nFetch;
        return await (await fetch(url, { body, headers: this.headers(), method: "POST" })).json();
    }

    async formatAndSendRecognizeRequest(signature: DecodedMessage): Promise<ShazamRoot | null>{
        let data = {
            'timezone': this.timezone,
            'signature': {
                'uri': signature.encodeToUri(),
                'samplems': Math.round(signature.numberSamples / signature.sampleRateHz * 1000)
            },
            'timestamp': new Date().getTime(),
            'context': {},
            'geolocation': {}
        };
        const url = new URL(this.url());
        Object.entries(this.params()).forEach(([a, b]) => url.searchParams.append(a, b));

        let response = await this.sendRecognizeRequest(url.toString(), JSON.stringify(data));
        if(response.matches.length === 0) return null;

        return response as ShazamRoot;
    }
}

export class Shazam{
    static MAX_TIME_SCEONDS = 8;

    public endpoint: Endpoint;
    constructor(timeZone?: string){
        this.endpoint = new Endpoint(timeZone ?? TIME_ZONE);
    }

    async recognizeSong(samples: number[], callback?: ((state: "generating" | "transmitting") => void)){
        let response = await this.fullRecognizeSong(samples, callback);
        if(!response) return null;

        const
            trackData = response.track,
            mainSection = trackData.sections.find((e: any) => e.type === "SONG")!;
        const
            title = trackData.title,
            artist = trackData.subtitle,
            album = mainSection.metadata!.find(e => e.title === "Album")?.text,
            year = mainSection.metadata!.find(e => e.title === "Released")?.text;
        return { title, artist, album, year };

    }

    async fullRecognizeSong(samples: number[], callback?: ((state: "generating" | "transmitting") => void)){
        callback?.("generating");
        const generator = new SignatureGenerator();
        const signature = generator.getSignature(samples);
        if(!signature){
            throw new Error("Failed to generate the signature!");
        }
        callback?.("transmitting");
        return this.endpoint.formatAndSendRecognizeRequest(signature);
    }
}
