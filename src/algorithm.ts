import { DecodedMessage, FrequencyBand, FrequencyPeak } from "./signature-format";
import { HANNING_MATRIX } from "./hanning";
import FFT from 'fft.js';

const pyMod = (a: number, b: number) => (a % b) >= 0 ? (a % b) : b + (a % b);

export class RingBuffer<T> {
    public list: (T|null)[];
    public position: number = 0;

    constructor(public bufferSize: number, defaultValue?: T | (() => T)){
        if(typeof defaultValue === 'function'){
            this.list = Array(bufferSize).fill(null).map(defaultValue as (() => T));
        }else{
            this.list = Array(bufferSize).fill(defaultValue ?? null);
        }
    }

}

export class SignatureGenerator{
    private ringBufferOfSamples!: RingBuffer<number>;
    private fftOutputs!: RingBuffer<Float32Array>;
    private spreadFFTsOutput!: RingBuffer<Float32Array>;
    private num_spread_ffts_done!: number;
    private nextSignature!: DecodedMessage;

    private initFields(){
        this.ringBufferOfSamples = new RingBuffer<number>(2048, 0);
        this.fftOutputs = new RingBuffer<Float32Array>(256, () => new Float32Array(Array(1025).fill(0)));
        this.spreadFFTsOutput = new RingBuffer<Float32Array>(256, () => new Float32Array(Array(1025).fill(0)));
        this.nextSignature = new DecodedMessage();
        this.nextSignature.sampleRateHz = 16000;
        this.nextSignature.numberSamples = 0;
        this.nextSignature.frequencyBandToSoundPeaks = {};
        this.num_spread_ffts_done = 0;
    }

    constructor(){
        this.initFields();
    }

    getSignature(s16leMonoSamples: number[]): DecodedMessage | null {
        const sliceLength = Math.min(12 * 16000, s16leMonoSamples.length);

        if(s16leMonoSamples.length > 12 * 16000) {
            const middle = Math.floor(s16leMonoSamples.length / 2);
            s16leMonoSamples = s16leMonoSamples.slice(middle - 6 * 16000, middle + 6 * 16000);
        }

        s16leMonoSamples = s16leMonoSamples.slice(0, sliceLength);

        this.nextSignature.numberSamples += s16leMonoSamples.length;
        for(let i = 0; i<s16leMonoSamples.length; i+= 128) {
            this.doFFT(s16leMonoSamples.slice(i, i + 128));
            this.doPeakSpreading();
            this.num_spread_ffts_done++;
            if(this.num_spread_ffts_done >= 46)
                this.doPeakRecognition();

        }
        let returnedSignature = this.nextSignature;
        this.initFields();

        return returnedSignature;
    }

    doFFT(batchOf128S16leMonoSamples: number[]){
        this.ringBufferOfSamples.list.splice(
            this.ringBufferOfSamples.position,
            batchOf128S16leMonoSamples.length,
            ...batchOf128S16leMonoSamples
        );

        this.ringBufferOfSamples.position += batchOf128S16leMonoSamples.length;
        this.ringBufferOfSamples.position %= 2048;

        let excerptFromRingBuffer = ([
            ...this.ringBufferOfSamples.list.slice(this.ringBufferOfSamples.position),
            ...this.ringBufferOfSamples.list.slice(0, this.ringBufferOfSamples.position),
        ] as number[]).map((v, i) => (v * HANNING_MATRIX[i]));

        const fft = new FFT(excerptFromRingBuffer.length);
        const out = fft.createComplexArray();
        fft.realTransform(out, excerptFromRingBuffer);
        out.splice(2050);

        let results = this.fftOutputs.list[pyMod(this.fftOutputs.position++, this.fftOutputs.bufferSize)]!;
        for(let i = 0; i<out.length; i += 2) {
            const e = ((out[i] * out[i]) + (out[i + 1] * out[i + 1])) / (1 << 17);
            results[i / 2] = Math.max(0.0000000001, e);
        }
    }

    doPeakSpreading(){
        let originLastFFT = this.fftOutputs.list[pyMod(this.fftOutputs.position - 1, this.fftOutputs.bufferSize)]!,
            spreadLastFFT = this.spreadFFTsOutput.list[pyMod(this.spreadFFTsOutput.position, this.spreadFFTsOutput.bufferSize)]!;
        spreadLastFFT.set(originLastFFT);

        for(let position = 0; position <= 1022; position++){
            spreadLastFFT[position] = Math.max(...spreadLastFFT.slice(position, position + 3));
        }
        for(let position = 0; position <= 1024; position++) {
            for(let formerFftNum of [-1, -3, -6]){
                let formerFftOutput = this.spreadFFTsOutput.list[pyMod(this.spreadFFTsOutput.position + formerFftNum, this.spreadFFTsOutput.bufferSize)]!;
                if(isNaN(formerFftOutput[position])) throw new Error();
                formerFftOutput[position] = Math.max(formerFftOutput[position], spreadLastFFT[position]);
            }
        }
        this.spreadFFTsOutput.position++;
    }

    doPeakRecognition(){
        let fftMinus46 = this.fftOutputs.list[pyMod(this.fftOutputs.position - 46, this.fftOutputs.bufferSize)]!;
        let fftMinus49 = this.spreadFFTsOutput.list[pyMod(this.spreadFFTsOutput.position - 49, this.spreadFFTsOutput.bufferSize)]!;

        for(let binPosition = 10; binPosition <= 1014; binPosition++){
            // Ensure that the bin is large enough to be a peak
            if((fftMinus46[binPosition] >= 1/64) && (fftMinus46[binPosition] >= fftMinus49[binPosition - 1])){
                let maxNeighborInFftMinus49 = 0;
                for(let neighborOffset of [-10, -7, -4, -3, 1, 2, 5, 8]){
                    const candidate = fftMinus49[binPosition + neighborOffset];
                    if(isNaN(candidate)) throw new Error();
                    maxNeighborInFftMinus49 = Math.max(candidate, maxNeighborInFftMinus49);
                }
                if(fftMinus46[binPosition] > maxNeighborInFftMinus49){
                    let maxNeighborInOtherAdjacentFFTs = maxNeighborInFftMinus49;
                    for(let otherOffset of 
                        [-53, -45,
                        165, 172, 179, 186, 193, 200,
                        214, 221, 228, 235, 242, 249]
                    ){
                        const candidate = this.spreadFFTsOutput.list[pyMod(this.spreadFFTsOutput.position + otherOffset, this.spreadFFTsOutput.bufferSize)]![binPosition - 1];
                        if(isNaN(candidate)) throw new Error();
                        maxNeighborInOtherAdjacentFFTs = Math.max(
                            candidate,
                            maxNeighborInOtherAdjacentFFTs
                        );
                    }
                    if(fftMinus46[binPosition] > maxNeighborInOtherAdjacentFFTs){
                        // This is a peak. Store the peak

                        let fftNumber = this.num_spread_ffts_done - 46;

                        let peakMagnitude = Math.log(Math.max(1 / 64, fftMinus46[binPosition])) * 1477.3 + 6144,
                            peakMagnitudeBefore = Math.log(Math.max(1 / 64, fftMinus46[binPosition-1])) * 1477.3 + 6144,
                            peakMagnitudeAfter = Math.log(Math.max(1 / 64, fftMinus46[binPosition+1])) * 1477.3 + 6144;

                        let peakVariation1 = peakMagnitude * 2 - peakMagnitudeBefore - peakMagnitudeAfter,
                            peakVariation2 = (peakMagnitudeAfter - peakMagnitudeBefore) * 32 / peakVariation1;

                        let correctedPeakFrequencyBin = ((binPosition * 64 + peakVariation2) & 0xFFFF) >>> 0;
                        if(peakVariation1 <= 0){
                            console.log("Assert 2 failed - " + peakVariation1);
                        }

                        let frequencyHz = correctedPeakFrequencyBin * (16000 / 2 / 1024 / 64);
                        let band;
                        if(frequencyHz < 250){
                            continue;
                        } else if(frequencyHz < 520){
                            band = FrequencyBand._250_520;
                        } else if(frequencyHz < 1450){
                            band = FrequencyBand._520_1450;
                        } else if(frequencyHz < 3500){
                            band = FrequencyBand._1450_3500;
                        } else if(frequencyHz <= 5500){
                            band = FrequencyBand._3500_5500;
                        } else continue;

                        if(!Object.keys(this.nextSignature.frequencyBandToSoundPeaks).includes(FrequencyBand[band])){
                            this.nextSignature.frequencyBandToSoundPeaks[FrequencyBand[band]] = [];
                        }
                        this.nextSignature.frequencyBandToSoundPeaks[FrequencyBand[band]].push(
                            new FrequencyPeak(fftNumber, (Math.round(peakMagnitude)) & 0xFFFF >>> 0, Math.round(correctedPeakFrequencyBin), 16000)
                        );
                    }
                }
            }
        }
    }
}
