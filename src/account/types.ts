import { LayerStyle } from '../state/layerTypes';

export interface AccountUser {
  id: string;
  email: string;
}

export interface SavedLayerMeta {
  id: string;
  name: string;
  sourceFormat: string;
  createdAt: string;
  featureCount: number;
}

export interface SavedLayerRecord extends SavedLayerMeta {
  style: LayerStyle;
  geojson: GeoJSON.FeatureCollection;
}

export interface SaveLayerInput {
  name: string;
  sourceFormat: string;
  style: LayerStyle;
  geojson: GeoJSON.FeatureCollection;
}

export type AccountMode = 'remote' | 'local';

export interface AccountService {
  readonly mode: AccountMode;
  currentUser(): Promise<AccountUser | null>;
  register(email: string, password: string): Promise<AccountUser>;
  login(email: string, password: string): Promise<AccountUser>;
  logout(): Promise<void>;
  listLayers(): Promise<SavedLayerMeta[]>;
  saveLayer(input: SaveLayerInput): Promise<SavedLayerMeta>;
  updateLayer(id: string, input: SaveLayerInput): Promise<void>;
  loadLayer(id: string): Promise<SavedLayerRecord>;
  deleteLayer(id: string): Promise<void>;
}

export class AccountError extends Error {
  constructor(public code: string) {
    super(code);
  }
}
