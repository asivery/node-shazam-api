export function s16LEToSamplesArray(rawSamples: Uint8Array){
    const samplesArray: number[] = [];
    for(let i = 0; i<rawSamples.length / 2; i++){
        samplesArray.push(rawSamples[2*i] | (rawSamples[2*i+1] << 8));
    }
    return samplesArray;
}
