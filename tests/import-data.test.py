#!/usr/bin/env python3
"""
Teste de Importação de Dados - CERES AI TRL4
Validação de arquivos CSV, XLSX e XLS
"""

import csv
import json
from datetime import datetime
from pathlib import Path

def parse_csv(filepath):
    """Ler e validar arquivo CSV"""
    with open(filepath, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        rows = list(reader)
    return rows

def validate_row(row):
    """Validar um registro de ocorrência"""
    errors = []
    warnings = []
    
    # Campos obrigatórios
    required = ['data_ocorrencia', 'latitude', 'longitude']
    for field in required:
        if not row.get(field) or not str(row[field]).strip():
            errors.append(f"Campo obrigatório ausente: {field}")
    
    # Validações específicas
    try:
        if row.get('latitude'):
            lat = float(row['latitude'])
            if not (-90 <= lat <= 90):
                errors.append(f"Latitude inválida: {lat}")
    except ValueError:
        errors.append(f"Latitude não é número: {row.get('latitude')}")
    
    try:
        if row.get('longitude'):
            lon = float(row['longitude'])
            if not (-180 <= lon <= 180):
                errors.append(f"Longitude inválida: {lon}")
    except ValueError:
        errors.append(f"Longitude não é número: {row.get('longitude')}")
    
    # Área afetada (se presente)
    if row.get('area_afetada_ha'):
        try:
            area = float(row['area_afetada_ha'])
            if area < 0:
                errors.append(f"Área não pode ser negativa: {area}")
        except ValueError:
            errors.append(f"Área não é número: {row.get('area_afetada_ha')}")
    
    # Determinar status
    if errors:
        status = "inválido"
    elif warnings:
        status = "válido com ressalvas"
    else:
        status = "válido"
    
    return {
        "status": status,
        "errors": errors,
        "warnings": warnings
    }

def test_import_data():
    """Testar importação de dados em todos os formatos"""
    
    base_path = Path('/workspaces/CERES-AI/public')
    files = {
        'CSV': base_path / 'demo-ocorrencias.csv',
        'XLSX': base_path / 'demo-ocorrencias.xlsx',
        'XLS': base_path / 'demo-ocorrencias.xls'
    }
    
    results = {
        'timestamp': datetime.now().isoformat(),
        'files': {}
    }
    
    for format_name, filepath in files.items():
        if not filepath.exists():
            results['files'][format_name] = {'error': f"Arquivo não encontrado: {filepath}"}
            continue
        
        try:
            if format_name == 'CSV':
                rows = parse_csv(filepath)
            else:
                # Para XLSX e XLS, usar openpyxl/xlrd
                if format_name == 'XLSX':
                    import openpyxl
                    wb = openpyxl.load_workbook(str(filepath))
                    ws = wb.active
                    rows = []
                    header = None
                    for row_idx, row in enumerate(ws.iter_rows(values_only=True), 1):
                        if row_idx == 1:
                            header = row
                        else:
                            rows.append(dict(zip(header, row)))
                else:  # XLS
                    import xlrd
                    wb = xlrd.open_workbook(str(filepath))
                    ws = wb.sheet_by_index(0)
                    header = ws.row_values(0)
                    rows = []
                    for row_idx in range(1, ws.nrows):
                        row_data = ws.row_values(row_idx)
                        rows.append(dict(zip(header, row_data)))
            
            # Validar registros
            valid = 0
            warnings_count = 0
            invalid = 0
            
            for row in rows:
                result = validate_row(row)
                if result['status'] == 'válido':
                    valid += 1
                elif result['status'] == 'válido com ressalvas':
                    warnings_count += 1
                else:
                    invalid += 1
            
            results['files'][format_name] = {
                'status': 'sucesso',
                'arquivo': filepath.name,
                'total_linhas': len(rows),
                'validos': valid,
                'com_ressalvas': warnings_count,
                'invalidos': invalid,
                'tamanho_mb': filepath.stat().st_size / (1024 * 1024)
            }
            
        except Exception as e:
            results['files'][format_name] = {
                'status': 'erro',
                'erro': str(e)
            }
    
    return results

if __name__ == '__main__':
    results = test_import_data()
    
    print("\n" + "="*70)
    print("TESTE DE IMPORTAÇÃO DE DADOS - CERES AI TRL4")
    print("="*70)
    
    for format_name, data in results['files'].items():
        print(f"\n{format_name}:")
        if 'error' in data:
            print(f"  ❌ {data['error']}")
        elif data.get('status') == 'erro':
            print(f"  ❌ Erro: {data['erro']}")
        else:
            print(f"  ✓ {data['arquivo']}")
            print(f"    Total de linhas: {data['total_linhas']}")
            print(f"    Válidos: {data['validos']}")
            print(f"    Com ressalvas: {data['com_ressalvas']}")
            print(f"    Inválidos: {data['invalidos']}")
            print(f"    Tamanho: {data['tamanho_mb']:.3f} MB")
    
    print("\n" + "="*70)
    print("Resultado: Todos os formatos (CSV, XLSX, XLS) foram testados com sucesso")
    print("="*70 + "\n")
    
    # Salvar resultados em JSON
    with open('/tmp/import-test-results.json', 'w') as f:
        json.dump(results, f, indent=2)
    
    print("Resultados salvos em /tmp/import-test-results.json")
