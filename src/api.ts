import { SignatureGenerator } from "./algorithm";
import { DecodedMessage } from "./signature-format";
import nFetch from 'node-fetch';

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
        return `${Endpoint.SCHEME}://${Endpoint.HOSTNAME}/discovery/v5/en/US/iphone/-/tag/${uuidv4()}/${uuidv4()}`;
    }
    params(){
        return {
            'sync': 'true',
            'webv3': 'true',
            'sampling': 'true',
            'connected': '',
            'shazamapiversion': 'v3',
            'sharehub': 'true',
            'hubv5minorversion': 'v5.1',
            'hidelb': 'true',
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
            "User-Agent": "Shazam/3685 CFNetwork/1197 Darwin/20.0.0"
        }
    }

    async sendRecognizeRequest(signature: DecodedMessage): Promise<{ title: string, artist: string, album?: string, year?: string } | null>{
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

        const fetch = global.fetch ?? nFetch;
        let response = await (await fetch(url.toString(), {
            body: JSON.stringify(data),
            headers: this.headers(),
            method: "POST",
        })).json();
        if(response.matches.length === 0) return null;

        const
            trackData = response.track,
            mainSection = trackData.sections.find((e: any) => e.type === "SONG");
        const
            title = trackData.title,
            artist = trackData.subtitle,
            album = mainSection.metadata.find((e: any) => e.title === "Album")?.text,
            year = mainSection.metadata.find((e: any) => e.title === "Released")?.text;
        return { title, artist, album, year };
    }
}

export class Shazam{
    static MAX_TIME_SCEONDS = 8;

    private endpoint: Endpoint;
    constructor(timeZone?: string){
        this.endpoint = new Endpoint(timeZone ?? TIME_ZONE);
    }

    async recognizeSong(samples: number[], callback?: ((state: "generating" | "transmitting") => void)){
        callback && callback("generating");
        let generator = this.createSignatureGenerator(samples);
        while(true){
            callback && callback("generating");
            const signature = generator.getNextSignature();
            if(!signature){
                break;
            }
            callback && callback("transmitting");
            let results = await this.endpoint.sendRecognizeRequest(signature);
            if(results !== null) return results;
        }
        return null;
    }

    createSignatureGenerator(samples: number[]){
        let signatureGenerator = new SignatureGenerator();
        signatureGenerator.feedInput(samples);
        return signatureGenerator;
    }
}
