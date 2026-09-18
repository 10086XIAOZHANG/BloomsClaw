export interface ModelDto {
  name: string;
  provider: string;
  active: 0 | 1;
  id: string;
  base_url: string;
  api_key: string;
  use_env_api_key: 0 | 1;
  temperature: number;
}
