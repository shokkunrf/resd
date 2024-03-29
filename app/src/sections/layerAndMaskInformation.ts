import { TodoError } from '../utils/error';
import {
  readText,
  readPascalString,
  readUnicodeString,
  readSignature,
} from '../utils/text';

// https://www.adobe.com/devnet-apps/photoshop/fileformatashtml/#50577409_pgfId-1031423

export class LayerAndMaskInformationSection {
  private readonly FIELDS_LENGTH_LENGTH = Uint32Array.BYTES_PER_ELEMENT;

  fieldsLength: number;
  layerInfo: LayerInfo;
  globalLayerMaskInfo: GlobalLayerMaskInfo;
  additionalLayerInformations: AdditionalLayerInformation[] = [];

  constructor(view: DataView, start: number) {
    this.fieldsLength = view.getUint32(start);
    this.layerInfo = new LayerInfo(view, start + this.FIELDS_LENGTH_LENGTH);
    this.globalLayerMaskInfo = new GlobalLayerMaskInfo(
      view,
      start + this.FIELDS_LENGTH_LENGTH + this.layerInfo.length
    );
    const pos =
      start + 4 + this.layerInfo.length + this.globalLayerMaskInfo.length;
    let len = 0;
    for (;;) {
      const sig = readSignature(view.buffer.slice(pos + len, pos + 4 + len));
      if (sig === null) {
        break;
      }

      const ali = new AdditionalLayerInformation(view, pos + len);
      this.additionalLayerInformations.push(ali);
      len += ali.length;
    }
    if (
      this.fieldsLength !==
      this.layerInfo.length + this.globalLayerMaskInfo.length + len
    ) {
      throw new Error('LayerAndMaskInformationSection length is invalid');
    }
  }

  get length(): number {
    return this.FIELDS_LENGTH_LENGTH + this.fieldsLength;
  }
}

class LayerInfo {
  private readonly LAYER_INFO_LENGTH_LENGTH = 4;
  private readonly LAYER_COUNT_LENGTH = 2;

  layerInfoLength: number;
  layerCount: number;
  layerRecords: LayerRecord[];
  channelImageData: ChannelImageData[][];
  length: number;

  constructor(view: DataView, start: number) {
    this.layerInfoLength = view.getUint32(start);
    this.layerCount = view.getInt16(start + this.LAYER_INFO_LENGTH_LENGTH);

    this.layerRecords = [];
    let layerRecordPosition =
      start + this.LAYER_INFO_LENGTH_LENGTH + this.LAYER_COUNT_LENGTH;

    for (let i = 0; i < Math.abs(this.layerCount); i++) {
      const layerRecord = new LayerRecord(view, layerRecordPosition);
      layerRecordPosition += layerRecord.length;
      this.layerRecords.push(layerRecord);
    }

    this.channelImageData = [];
    for (let i = 0; i < Math.abs(this.layerCount); i++) {
      const layerChannelImageData = this.layerRecords[
        i
      ].channelInformations.map((c) => {
        const channelImageData = new ChannelImageData(
          view,
          layerRecordPosition,
          this.layerRecords[i],
          c
        );
        if (channelImageData.length !== c.channelDataLength) {
          throw new Error('channelImageData.length is invalid');
        }
        layerRecordPosition += channelImageData.length;
        return channelImageData;
      });
      this.channelImageData.push(layerChannelImageData);
    }

    this.length = layerRecordPosition - start;

    // this.length += this.length % 4 === 0 ? 0 : 4 - (this.length % 4);
    // if (this.layerInfoLength + 4 !== this.length) {}
    if (this.length > this.layerInfoLength + 4) {
      throw new Error('layerInfoLength is invalid');
    }
    this.length = this.layerInfoLength + 4;
  }
}

type ChannelInformation = {
  channelId: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | -1 | -2 | -3;
  channelDataLength: number;
};

class LayerRecord {
  coordinates: { top: number; left: number; bottom: number; right: number };
  channelNum: number;
  channelInformations: ChannelInformation[] = [];
  signature: '8BIM'; // 8BIM
  blendModeKey: string;
  opacity: number;
  clipping: number;
  flags: number;
  filler: number;
  extraDataFieldLength: number;
  layerMaskData: LayerMaskData;
  layerBlendingRanges: LayerBlendingRanges;
  layerName: string;
  additionalLayerInformations: AdditionalLayerInformation[] = [];

  lll: number;

  constructor(view: DataView, start: number) {
    this.coordinates = {
      top: view.getUint32(start),
      left: view.getUint32(start + 4),
      bottom: view.getUint32(start + 8),
      right: view.getUint32(start + 12),
    };
    this.channelNum = view.getUint16(start + 16);

    let channelInformationPosition = 18;
    for (let i = 0; i < this.channelNum; i++) {
      const id = view.getInt16(start + channelInformationPosition);
      if (
        !(
          id === 0 ||
          id === 1 ||
          id === 2 ||
          id === 3 ||
          id === 4 ||
          id === 5 ||
          id === 6 ||
          id === 7 ||
          id === 8 ||
          id === 9 ||
          id === -1 ||
          id === -2 ||
          id === -3
        )
      ) {
        throw new Error(`channelID is invalid: ${id}`);
      }
      const info: ChannelInformation = {
        channelId: id,
        channelDataLength: view.getUint32(
          start + channelInformationPosition + 2
        ),
      };
      this.channelInformations.push(info);
      channelInformationPosition += 6;
    }

    const signatureLength = 4;
    const sig = readText(
      view.buffer.slice(
        start + channelInformationPosition,
        start + channelInformationPosition + signatureLength
      ),
      'utf-8'
    );
    if (sig !== '8BIM') {
      throw new Error('LayerRecord.signature invalid');
    }
    this.signature = sig;

    const blendModeKeyLength = 4;
    this.blendModeKey = readText(
      view.buffer.slice(
        start + channelInformationPosition + signatureLength,
        start +
          channelInformationPosition +
          signatureLength +
          blendModeKeyLength
      ),
      'utf-8'
    );

    this.opacity = view.getUint8(
      start + channelInformationPosition + signatureLength + blendModeKeyLength
    );
    this.clipping = view.getUint8(
      start +
        channelInformationPosition +
        signatureLength +
        blendModeKeyLength +
        1
    );
    this.flags = view.getUint8(
      start +
        channelInformationPosition +
        signatureLength +
        blendModeKeyLength +
        1 +
        1
    );
    this.filler = view.getUint8(
      start +
        channelInformationPosition +
        signatureLength +
        blendModeKeyLength +
        1 +
        1 +
        1
    );
    this.extraDataFieldLength = view.getUint32(
      start +
        channelInformationPosition +
        signatureLength +
        blendModeKeyLength +
        1 +
        1 +
        1 +
        1
    );

    const a =
      channelInformationPosition +
      signatureLength +
      blendModeKeyLength +
      1 +
      1 +
      1 +
      1 +
      4;
    this.layerMaskData = new LayerMaskData(view, start + a);
    this.layerBlendingRanges = new LayerBlendingRanges(
      view,
      start + a + this.layerMaskData.length
    );
    const b =
      start + a + this.layerMaskData.length + this.layerBlendingRanges.length;

    const [layerName, layerNameLength] = readPascalString(
      view.buffer.slice(b),
      'shift-jis'
    );
    const padding =
      layerNameLength +
      (layerNameLength % 4 === 0 ? 0 : 4 - (layerNameLength % 4));

    this.layerName = layerName;
    let len = 0;
    for (;;) {
      const sig = readSignature(
        view.buffer.slice(b + padding + len, b + padding + 4 + len)
      );
      if (sig === null) {
        break;
      }

      const ali = new AdditionalLayerInformation(view, b + padding + len);
      this.additionalLayerInformations.push(ali);
      len += ali.length;
    }

    this.lll = b + padding - start + len;
  }

  get length(): number {
    return this.lll;
  }
}

type Rectangle = {
  top: number;
  left: number;
  bottom: number;
  right: number;
};
class LayerMaskData {
  layerMaskDataLength: number;
  rectangle: Rectangle | null = null;
  defaultColor: number | null = null; // 0 or 255
  flags: number | null = null;
  maskParameters: number | null = null;
  maskParametersFlags: number | null = null;
  padding: number | null = null;
  realFlags: number | null = null;
  realUserMaskBackground: number | null = null; // 0 or 255
  rectangleEnclosingLayerMask: Rectangle | null = null;

  constructor(view: DataView, start: number) {
    this.layerMaskDataLength = view.getUint32(start);
    if (this.layerMaskDataLength === 0) {
      return;
    }
    this.rectangle = {
      top: view.getUint32(start + 4),
      left: view.getUint32(start + 8),
      bottom: view.getUint32(start + 12),
      right: view.getUint32(start + 16),
    };
    this.defaultColor = view.getUint8(start + 20);
    this.flags = view.getUint8(start + 21);

    let position = 22;
    if (this.flags === 8) {
      this.maskParameters = view.getUint8(start + position);
      position += 1;
      if (this.maskParameters === 0) {
        this.maskParametersFlags = view.getUint8(start + position);
        position += 1;
      } else if (this.maskParameters === 1) {
        this.maskParametersFlags = view.getFloat64(start + position);
        position += 8;
      } else if (this.maskParameters === 2) {
        this.maskParametersFlags = view.getUint8(start + position);
        position += 1;
      } else if (this.maskParameters === 4) {
        this.maskParametersFlags = view.getFloat64(start + position);
        position += 8;
      }
    }

    if (this.layerMaskDataLength === 20) {
      this.padding = view.getUint16(start + position);
      return;
    }

    this.realFlags = view.getUint8(start + position);
    this.realUserMaskBackground = view.getUint8(start + position + 1);
    this.rectangleEnclosingLayerMask = {
      top: view.getUint32(start + position + 1 + 1),
      left: view.getUint32(start + position + 1 + 1 + 4),
      bottom: view.getUint32(start + position + 1 + 1 + 8),
      right: view.getUint32(start + position + 1 + 1 + 12),
    };
  }

  get length(): number {
    return 4 + this.layerMaskDataLength;
  }
}

class LayerBlendingRanges {
  layerBlendhingRangesLength: number;
  compositeGrayBlendSource: object | null = null;
  compositeGrayBlendDestinationRange: number | null = null;
  channelSources: object[] = [];

  constructor(view: DataView, start: number) {
    this.layerBlendhingRangesLength = view.getUint32(start);
    if (this.layerBlendhingRangesLength === 0) {
      return;
    }
    this.compositeGrayBlendSource = {
      b1: view.getUint8(start + 4),
      b2: view.getUint8(start + 5),
      w1: view.getUint8(start + 6),
      w2: view.getUint8(start + 7),
    };
    this.compositeGrayBlendDestinationRange = view.getUint32(start + 8);

    for (
      let position = 12;
      position < this.layerBlendhingRangesLength;
      position += 8
    ) {
      this.channelSources.push({
        sourceRange: view.getUint32(start + position),
        destinationRange: view.getUint32(start + position + 4),
      });
    }
  }

  get length(): number {
    return 4 + this.layerBlendhingRangesLength;
  }
}

class AdditionalLayerInformation {
  signature: string; // 8BIM
  key: string;
  dataLength: number;
  data:
    | Luni
    | Lsct
    | Lyid
    | Clbl
    | Infx
    | Knko
    | Lspf
    | Lclr
    | Shmd
    | Fxrp
    | Lnsr
    | Lyvr
    | Patt
    | Fmsk
    | Cinf;

  constructor(view: DataView, start: number) {
    const sig = readSignature(view.buffer.slice(start, start + 4));
    this.signature = sig ?? '';

    this.key = readText(view.buffer.slice(start + 4, start + 8), 'utf-8');

    this.dataLength = view.getUint32(start + 8);

    if (this.key === 'luni') {
      this.data = new Luni(view, start + 12);
      return;
    }
    if (this.key === 'lsct') {
      this.data = new Lsct(view, start + 12, this.dataLength);
      return;
    }
    if (this.key === 'lyid') {
      this.data = new Lyid(view, start + 12);
      return;
    }
    if (this.key === 'clbl') {
      this.data = new Clbl(view, start + 12);
      return;
    }
    if (this.key === 'infx') {
      this.data = new Infx(view, start + 12);
      return;
    }
    if (this.key === 'knko') {
      this.data = new Knko(view, start + 12);
      return;
    }
    if (this.key === 'lspf') {
      this.data = new Lspf(view, start + 12);
      return;
    }
    if (this.key === 'lclr') {
      this.data = new Lclr(view, start + 12);
      return;
    }
    if (this.key === 'shmd') {
      this.data = new Shmd(view, start + 12);
      return;
    }
    if (this.key === 'fxrp') {
      this.data = new Fxrp(view, start + 12);
      return;
    }
    if (this.key === 'lnsr') {
      this.data = new Lnsr(view, start + 12);
      return;
    }
    if (this.key === 'lyvr') {
      this.data = new Lyvr(view, start + 12);
      return;
    }
    if (this.key === 'Patt' || this.key === 'Pat2' || this.key === 'Pat3') {
      this.data = new Patt(view, start + 12, this.dataLength);
      return;
    }
    if (this.key === 'FMsk') {
      this.data = new Fmsk(view, start + 12);
      return;
    }
    if (this.key === 'cinf') {
      this.data = new Cinf(view, start + 12);
      return;
    }

    throw new Error(`another ali ${this.key}`);
  }

  get length(): number {
    return (
      Uint32Array.BYTES_PER_ELEMENT +
      Uint32Array.BYTES_PER_ELEMENT +
      Uint32Array.BYTES_PER_ELEMENT +
      this.dataLength +
      (this.dataLength % 2 === 0 ? 0 : 1)
    );
  }
}

class Luni {
  text: string;
  length: number;

  constructor(view: DataView, start: number) {
    const [utf16Text, utf16Length] = readUnicodeString(
      view.buffer.slice(start)
    );
    this.text = utf16Text;
    this.length = utf16Length;
  }
}

class Lsct {
  type: 0 | 1 | 2 | 3;
  signature: '8BIM' | null = null;
  blendModeKey: string | null = null;
  subType: 0 | 1 | null = null;

  constructor(view: DataView, start: number, length: number) {
    const type = view.getUint32(start);
    if (!(type === 0 || type === 1 || type === 2 || type === 3)) {
      throw new Error('Lsct.type invalid');
    }
    this.type = type;

    if (length >= 12) {
      this.signature = (() => {
        const a = readText(view.buffer.slice(start + 4, start + 8), 'utf-8'); // 8BIM
        if (a !== '8BIM') {
          return null;
        }
        return a;
      })();

      this.blendModeKey = readText(
        view.buffer.slice(start + 4, start + 8),
        'utf-8'
      );
    }

    if (length >= 18) {
      const subType = view.getUint32(start + 12);
      if (!(subType === 0 || subType === 1)) {
        throw new Error('');
      }
      this.subType = subType;
    }
  }
}

class Lyid {
  id: number;

  constructor(view: DataView, start: number) {
    this.id = view.getUint32(start);
  }
}

class Clbl {
  blendClippedElements: boolean;

  constructor(view: DataView, start: number) {
    this.blendClippedElements = view.getUint8(start) !== 0;
  }
}

class Infx {
  blendClippedElements: boolean;

  constructor(view: DataView, start: number) {
    this.blendClippedElements = view.getUint8(start) !== 0;
  }
}

class Knko {
  knockout: boolean;

  constructor(view: DataView, start: number) {
    this.knockout = view.getUint8(start) !== 0;
  }
}

class Lspf {
  protectionFlags: number[] = [];

  constructor(view: DataView, start: number) {
    for (let i = 0; i < 4; i++) {
      this.protectionFlags.push(view.getUint8(start + i));
    }
  }
}

class Lclr {
  colors: number[] = [];

  constructor(view: DataView, start: number) {
    for (let i = 0; i < 2; i++) {
      this.colors.push(view.getUint16(start + i * 4));
    }
  }
}

class Shmd {
  metaddataItemCount: number;
  metadata: {
    signature: number;
    key: number;
    sheetDuplication: number;
    dataLength: number;
    data: number;
  }[] = [];

  constructor(view: DataView, start: number) {
    this.metaddataItemCount = view.getUint32(start);
    for (let i = 0, pos = start; i < this.metaddataItemCount; i++) {
      const metadata = {
        signature: view.getUint32(pos),
        key: view.getUint32(pos + 4),
        sheetDuplication: view.getUint8(pos + 8),
        dataLength: view.getUint32(pos + 12),
        data: view.getUint32(pos + 16),
      };
      this.metadata.push(metadata);
      pos += 16 + metadata.dataLength;
    }
  }
}

class Fxrp {
  referencePoint: number[] = [];

  constructor(view: DataView, start: number) {
    for (let i = 0; i < 8; i++) {
      this.referencePoint.push(view.getUint16(start + i * 2));
    }
  }
}

class Lnsr {
  id: number;

  constructor(view: DataView, start: number) {
    this.id = view.getUint32(start);
  }
}

class Lyvr {
  id: number;

  constructor(view: DataView, start: number) {
    this.id = view.getUint32(start);
  }
}

class Patt {
  patterns: {
    patternLength: number;
    // version: 1;
    // imageMode: 0 | 1 | 2 | 3 | 4 | 7 | 8 | 9;
    // point: {
    //   vertical: number;
    //   horizontal: number;
    // };
    // name: string;
    // uniqueId: string;
    // indexColorTable: {
    //   red: number; // Uint8
    //   green: number; // Uint8
    //   blue: number; // Uint8
    // };
    // patternData: VirtualMemoryArrayList;
  }[] = [];

  constructor(view: DataView, start: number, length: number) {
    for (let len = 0; len < length; ) {
      const pattern = {
        patternLength: view.getUint32(start),
      };
      len += 4;
      this.patterns.push(pattern);
      if (pattern.patternLength === 0) {
        continue;
      }
      throw new TodoError();
    }
  }
}

class Fmsk {
  // colorSpace:number;
  opacity: number;

  constructor(view: DataView, start: number) {
    // this.colorSpace =
    this.opacity = view.getUint16(start + 10);
  }
}

class Cinf {
  version: 16;
  // descriptor: DescriptorStructure;

  constructor(view: DataView, start: number) {
    const version = view.getUint32(start);
    if (version !== 16) {
      throw new Error('Cinf.version is invalid');
    }
    this.version = version;
  }
}

class ChannelImageData {
  compression: 0 | 1 | 2 | 3;
  imageData: ArrayBuffer;
  length: number;

  constructor(
    view: DataView,
    start: number,
    layerRecord: LayerRecord,
    channelInformation: ChannelInformation
  ) {
    const compression = view.getUint16(start);
    if (
      !(
        compression === 0 ||
        compression === 1 ||
        compression === 2 ||
        compression === 3
      )
    ) {
      throw new Error(`channelImageData invalid compression ${compression}`);
    }
    this.compression = compression;

    let rect;
    if (
      channelInformation.channelId === -2 &&
      layerRecord.layerMaskData.rectangle
    ) {
      rect = layerRecord.layerMaskData.rectangle;
    } else if (
      channelInformation.channelId === -3 &&
      layerRecord.layerMaskData.rectangleEnclosingLayerMask
    ) {
      rect = layerRecord.layerMaskData.rectangleEnclosingLayerMask;
    } else {
      rect = layerRecord.coordinates;
    }

    if (this.compression === 0) {
      const len = (rect.bottom - rect.top) * (rect.right - rect.left);
      this.imageData = view.buffer.slice(start + 2, start + 2 + len);
      this.length = 2 + len;
      // this.length = 2 + len + (len % 2 === 0 ? 0 : 1);
      return;
    }

    if (this.compression === 1) {
      let pos = 2; // imageData start

      const rowCount = rect.bottom - rect.top;
      let len = 0;
      for (let i = 0; i < rowCount; i++) {
        len += view.getUint16(start + pos + 2 * i);
      }

      const rleHeadLength = 2 * rowCount;
      pos += rleHeadLength + len;
      // pos += rleHeadLength + len + (len % 2 === 0 ? 0 : 1);

      this.length = pos;
      this.imageData = view.buffer.slice(start + 2, start + 2 + this.length);
      return;
    }

    if (this.compression === 2) {
      throw new TodoError('compression 2');
    }
    throw new TodoError('compression 3');
  }
}

class GlobalLayerMaskInfo {
  sectionLength: number;
  overlayColorSpace: number | null = null;
  colorComponents: number[] | null = null;
  opacity: number | null = null;
  kind: 0 | 1 | 128 | null = null;
  filler: string | null = null;

  constructor(view: DataView, start: number) {
    this.sectionLength = view.getUint32(start);
    if (this.sectionLength === 0) {
      return;
    }

    this.overlayColorSpace = view.getUint16(start + 4);
    this.colorComponents = [];
    for (let i = 0; i < 4; i++) {
      this.colorComponents.push(view.getUint16(start + 6 + i * 2));
    }
    // if (!(opacity === 0 || opacity === 100)) {
    //   throw new Error(`GlobalLayerMaskInfo.opacity invalid: ${opacity}`);
    // }
    this.opacity = view.getUint16(start + 14);

    const kind = view.getUint8(start + 16);
    if (!(kind === 0 || kind === 1 || kind === 128)) {
      throw new Error('GlobalLayerMaskInfo.kind invalid');
    }
    this.kind = kind;

    this.filler = '';
    for (let i = 0; i < this.sectionLength - 17; i++) {
      this.filler += '0';
    }
  }

  get length(): number {
    return Uint32Array.BYTES_PER_ELEMENT + this.sectionLength;
  }
}
