export function s16LEToSamplesArray(rawSamples: Uint8Array){
    const samplesArray: number[] = [];
    const dataView = new DataView(rawSamples.buffer);
    for(let i = 0; i<rawSamples.length; i += 2){
        samplesArray.push(dataView.getInt16(i, true));
    }
    return samplesArray;
}
