import { DocConfig } from './index';

function upperCase(tag: string) {
  return tag.toUpperCase();
}

export class TagValidator {
  private _include?: string[];
  private _exclude?: string[];

  constructor(config: DocConfig) {
    this._include = config.include?.map(upperCase);
    this._exclude = config.exclude?.map(upperCase);
  }

  validate(tag: string) {
    const { _include, _exclude } = this;

    tag = upperCase(tag);

    if (_include && _include.indexOf(tag) < 0) {
      return false;
    }

    if (_exclude && _exclude.indexOf(tag) >= 0) {
      return false;
    }

    return true;
  }
}
