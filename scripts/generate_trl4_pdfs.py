#!/usr/bin/env python3
"""
Gerador de PDFs de Evidências TRL 4 - CERES AI
Converte documentos Markdown para PDF anonimizado
"""

from reportlab.lib.pagesizes import A4, letter
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Image, Table, TableStyle, PageBreak, Preformatted
from reportlab.lib import colors
from reportlab.pdfgen import canvas
from datetime import datetime
import os
from pathlib import Path

class PDFGenerator:
    def __init__(self):
        self.styles = getSampleStyleSheet()
        self.output_dir = Path("/workspaces/CERES-AI/docs/trl4/final/pdfs")
        self.output_dir.mkdir(exist_ok=True)
        self.create_custom_styles()
    
    def create_custom_styles(self):
        """Criar estilos personalizados"""
        self.styles.add(ParagraphStyle(
            name='CustomTitle',
            parent=self.styles['Heading1'],
            fontSize=24,
            textColor=colors.HexColor('#1a5490'),
            spaceAfter=30,
            alignment=1,  # center
            fontName='Helvetica-Bold'
        ))
        
        self.styles.add(ParagraphStyle(
            name='CustomHeading',
            parent=self.styles['Heading2'],
            fontSize=14,
            textColor=colors.HexColor('#2e75b6'),
            spaceAfter=12,
            spaceBefore=12,
            fontName='Helvetica-Bold'
        ))
        
        self.styles.add(ParagraphStyle(
            name='CustomBody',
            parent=self.styles['Normal'],
            fontSize=10,
            leading=14,
            spaceAfter=12,
            alignment=4  # justify
        ))

    def generate_pdf_1_maturidade(self):
        """PDF 1: Evidências de Maturidade Tecnológica"""
        pdf_file = self.output_dir / "01_Evidencias_de_Maturidade_Tecnologica_TRL4.pdf"
        doc = SimpleDocTemplate(str(pdf_file), pagesize=A4, topMargin=0.5*inch, bottomMargin=0.5*inch)
        
        story = []
        
        # Capa
        story.append(Spacer(1, 1*inch))
        story.append(Paragraph("EVIDÊNCIAS DE MATURIDADE TECNOLÓGICA", self.styles['CustomTitle']))
        story.append(Paragraph("TRL 4 — Demonstração de Conceito Validada", self.styles['Heading3']))
        story.append(Spacer(1, 0.5*inch))
        story.append(Paragraph("Plataforma Preditiva de Inteligência Ambiental", self.styles['CustomBody']))
        story.append(Paragraph(f"Julho de 2026", self.styles['CustomBody']))
        story.append(PageBreak())
        
        # Sumário
        story.append(Paragraph("SUMÁRIO", self.styles['CustomHeading']))
        contents = [
            "1. Introdução e Objetivo",
            "2. Estágio Tecnológico (TRL 4)",
            "3. Arquitetura do Sistema",
            "4. Componentes Implementados",
            "5. Validações Realizadas",
            "6. Limitações Documentadas",
            "7. Conclusão"
        ]
        for item in contents:
            story.append(Paragraph(f"• {item}", self.styles['Normal']))
        story.append(PageBreak())
        
        # Conteúdo
        story.append(Paragraph("1. INTRODUÇÃO E OBJETIVO", self.styles['CustomHeading']))
        story.append(Paragraph(
            "Apresentar evidências de maturidade tecnológica de uma plataforma de análise preditiva de risco de incêndios florestais, "
            "demonstrando funcionalidades implementadas, testes executados e validações realizadas conforme o Nível de Prontidão Tecnológica 4.",
            self.styles['CustomBody']
        ))
        story.append(Spacer(1, 0.2*inch))
        
        story.append(Paragraph("2. ESTÁGIO TECNOLÓGICO (TRL 4)", self.styles['CustomHeading']))
        story.append(Paragraph(
            "TRL 4 (Demonstração de Conceito Validada) representa o ponto em que a tecnologia é demonstrada em ambiente "
            "controlado com validação de funcionalidades críticas através de testes automatizados e manuais.",
            self.styles['CustomBody']
        ))
        story.append(Spacer(1, 0.2*inch))
        
        story.append(Paragraph("3. ARQUITETURA DO SISTEMA", self.styles['CustomHeading']))
        
        # Tabela de arquitetura
        arch_data = [
            ['Camada', 'Tecnologia', 'Função'],
            ['Frontend', 'React 18.3 + Vite', 'Interface do usuário responsiva'],
            ['Backend', 'Express.js + TypeScript', 'API REST e autenticação'],
            ['ML/Análise', 'Python/FastAPI + Scikit-learn', 'Motor de análise de risco'],
            ['Banco de Dados', 'PostgreSQL + Drizzle ORM', 'Persistência de dados'],
            ['Mapa/Visualização', 'Leaflet.js', 'Visualização geográfica']
        ]
        
        t = Table(arch_data, colWidths=[1.5*inch, 2*inch, 1.5*inch])
        t.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#2e75b6')),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
            ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, 0), 10),
            ('BOTTOMPADDING', (0, 0), (-1, 0), 12),
            ('BACKGROUND', (0, 1), (-1, -1), colors.beige),
            ('GRID', (0, 0), (-1, -1), 1, colors.black),
            ('FONTSIZE', (0, 1), (-1, -1), 9),
        ]))
        story.append(t)
        story.append(Spacer(1, 0.3*inch))
        
        story.append(Paragraph("4. COMPONENTES IMPLEMENTADOS", self.styles['CustomHeading']))
        
        components = [
            ("Análise de Risco", "Motor de cálculo de score de 0-100 com classificação em 4 níveis (baixo, moderado, alto, crítico)"),
            ("Fatores Explicativos", "Identificação automática dos fatores que influenciam o score de risco"),
            ("Recomendações", "Sugestões de ações preventivas e de monitoramento baseadas no nível de risco"),
            ("Importação de Dados", "Suporte a CSV, XLSX e XLS para carga de histórico de ocorrências"),
            ("Autenticação", "Sistema de login com criptografia bcrypt e sessões seguras"),
            ("Modo Anônimo", "Submissão sem identificação pessoal ou institucional"),
        ]
        
        for comp_name, comp_desc in components:
            story.append(Paragraph(f"<b>{comp_name}:</b> {comp_desc}", self.styles['CustomBody']))
            story.append(Spacer(1, 0.1*inch))
        
        story.append(PageBreak())
        story.append(Paragraph("5. VALIDAÇÕES REALIZADAS", self.styles['CustomHeading']))
        
        # Tabela de validações
        val_data = [
            ['Tipo', 'Total', 'Aprovados', 'Status'],
            ['Testes TypeScript', '44', '44', '✓'],
            ['Testes Python', '104', '104', '✓'],
            ['Cenários de Risco', '4', '4', '✓'],
            ['Importação de Dados', '3 formatos', '3', '✓'],
            ['Endpoints', '5', '5', '✓'],
        ]
        
        t2 = Table(val_data, colWidths=[1.8*inch, 1.2*inch, 1.2*inch, 0.8*inch])
        t2.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#2e75b6')),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, 0), 10),
            ('BOTTOMPADDING', (0, 0), (-1, 0), 12),
            ('BACKGROUND', (0, 1), (-1, -1), colors.lightgrey),
            ('GRID', (0, 0), (-1, -1), 1, colors.black),
            ('FONTSIZE', (0, 1), (-1, -1), 9),
        ]))
        story.append(t2)
        story.append(Spacer(1, 0.3*inch))
        
        story.append(Paragraph("6. LIMITAÇÕES DOCUMENTADAS", self.styles['CustomHeading']))
        
        limitations = [
            "Dataset de treinamento ML é sintético, não representa incêndios reais",
            "Modelo supervisionado apresentado como experimental",
            "Validação operacional com dados reais prevista para Prova de Valor",
            "Ambiente de teste é de desenvolvimento, não produção escalada",
        ]
        
        for lim in limitations:
            story.append(Paragraph(f"• {lim}", self.styles['CustomBody']))
        story.append(Spacer(1, 0.3*inch))
        
        story.append(Paragraph("7. CONCLUSÃO", self.styles['CustomHeading']))
        story.append(Paragraph(
            "O sistema demonstra maturidade TRL 4, com funcionalidades validadas através de 148 testes automatizados "
            "e 4 cenários de uso. As limitações são documentadas explicitamente, e o sistema está pronto para fase de Prova de Valor com dados reais.",
            self.styles['CustomBody']
        ))
        
        # Rodapé
        story.append(Spacer(1, 0.5*inch))
        story.append(Paragraph(f"Documento gerado em 2026-07-21 18:00 UTC", self.styles['Normal']))
        story.append(Paragraph("Plataforma Preditiva de Inteligência Ambiental", self.styles['Normal']))
        
        doc.build(story)
        return pdf_file

    def generate_pdf_2_relatorio(self):
        """PDF 2: Relatório de Testes"""
        pdf_file = self.output_dir / "02_Relatorio_de_Testes_TRL4.pdf"
        doc = SimpleDocTemplate(str(pdf_file), pagesize=A4, topMargin=0.5*inch, bottomMargin=0.5*inch)
        
        story = []
        
        # Capa
        story.append(Spacer(1, 1.2*inch))
        story.append(Paragraph("RELATÓRIO DE TESTES", self.styles['CustomTitle']))
        story.append(Paragraph("Validação Técnica TRL 4", self.styles['Heading3']))
        story.append(Spacer(1, 0.5*inch))
        story.append(Paragraph("2026-07-21", self.styles['CustomBody']))
        story.append(PageBreak())
        
        # Resumo Executivo
        story.append(Paragraph("RESUMO EXECUTIVO", self.styles['CustomHeading']))
        story.append(Paragraph(
            "<b>Resultado Total:</b> 148 testes executados | 148 aprovados | 0 falhas",
            self.styles['CustomBody']
        ))
        story.append(Spacer(1, 0.2*inch))
        
        story.append(Paragraph("BREAKDOWN POR TIPO", self.styles['CustomHeading']))
        
        breakdown_data = [
            ['Tipo de Teste', 'Total', 'Aprovados', 'Taxa de Sucesso'],
            ['TypeScript - Risco', '34', '34', '100%'],
            ['TypeScript - Autenticação', '10', '10', '100%'],
            ['Python - API', '20', '20', '100%'],
            ['Python - Modelo', '27', '27', '100%'],
            ['Python - Risco', '34', '34', '100%'],
            ['Python - Validação', '23', '23', '100%'],
            ['<b>TOTAL</b>', '<b>148</b>', '<b>148</b>', '<b>100%</b>'],
        ]
        
        t = Table(breakdown_data, colWidths=[2.2*inch, 1*inch, 1.2*inch, 1.6*inch])
        t.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#2e75b6')),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, 0), 9),
            ('BOTTOMPADDING', (0, 0), (-1, 0), 12),
            ('BACKGROUND', (0, 1), (-1, -2), colors.lightgrey),
            ('BACKGROUND', (0, -1), (-1, -1), colors.HexColor('#d9e2f3')),
            ('GRID', (0, 0), (-1, -1), 1, colors.black),
            ('FONTSIZE', (0, 1), (-1, -1), 8),
            ('FONTNAME', (0, -1), (-1, -1), 'Helvetica-Bold'),
        ]))
        story.append(t)
        story.append(Spacer(1, 0.3*inch))
        
        story.append(Paragraph("CENÁRIOS DE RISCO TESTADOS", self.styles['CustomHeading']))
        
        scenarios_data = [
            ['Cenário', 'Input', 'Score', 'Nível', 'Status'],
            ['Baixo', 'T:22°C, U:78%, V:7km/h', '17', 'baixo', '✓'],
            ['Moderado', 'T:30°C, U:48%, V:16km/h', '39', 'moderado', '✓'],
            ['Alto', 'T:35°C, U:28%, V:26km/h', '62', 'alto', '✓'],
            ['Crítico', 'T:40°C, U:15%, V:42km/h', '82', 'crítico', '✓'],
        ]
        
        t2 = Table(scenarios_data, colWidths=[1.2*inch, 2.4*inch, 1*inch, 1*inch, 0.6*inch])
        t2.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#2e75b6')),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, 0), 9),
            ('BOTTOMPADDING', (0, 0), (-1, 0), 12),
            ('BACKGROUND', (0, 1), (-1, -1), colors.lightgrey),
            ('GRID', (0, 0), (-1, -1), 1, colors.black),
            ('FONTSIZE', (0, 1), (-1, -1), 8),
        ]))
        story.append(t2)
        story.append(Spacer(1, 0.3*inch))
        
        story.append(Paragraph("ENDPOINTS TESTADOS", self.styles['CustomHeading']))
        
        endpoints_data = [
            ['Endpoint', 'Método', 'Status', 'Resposta'],
            ['GET /health', 'GET', '200 OK', 'Service OK'],
            ['POST /analyze-risk', 'POST', '200 OK', 'Score + Factors'],
            ['GET /api/import-batches (sem auth)', 'GET', '401', 'Not Authenticated'],
            ['GET /api/fire-occurrences (sem auth)', 'GET', '401', 'Not Authenticated'],
        ]
        
        t3 = Table(endpoints_data, colWidths=[2*inch, 1*inch, 1.2*inch, 1.8*inch])
        t3.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#2e75b6')),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
            ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, 0), 9),
            ('BOTTOMPADDING', (0, 0), (-1, 0), 12),
            ('BACKGROUND', (0, 1), (-1, -1), colors.lightgrey),
            ('GRID', (0, 0), (-1, -1), 1, colors.black),
            ('FONTSIZE', (0, 1), (-1, -1), 8),
        ]))
        story.append(t3)
        story.append(Spacer(1, 0.3*inch))
        
        story.append(PageBreak())
        story.append(Paragraph("IMPORTAÇÃO DE DADOS", self.styles['CustomHeading']))
        
        import_data = [
            ['Formato', 'Total de Registros', 'Válidos', 'Status'],
            ['CSV', '20', '20', '✓'],
            ['XLSX', '20', '20', '✓'],
            ['XLS', '20', '20', '✓'],
        ]
        
        t4 = Table(import_data, colWidths=[1.5*inch, 2*inch, 1.5*inch, 1.5*inch])
        t4.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#2e75b6')),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, 0), 9),
            ('BOTTOMPADDING', (0, 0), (-1, 0), 12),
            ('BACKGROUND', (0, 1), (-1, -1), colors.lightgrey),
            ('GRID', (0, 0), (-1, -1), 1, colors.black),
            ('FONTSIZE', (0, 1), (-1, -1), 9),
        ]))
        story.append(t4)
        story.append(Spacer(1, 0.3*inch))
        
        story.append(Paragraph("CONCLUSÃO", self.styles['CustomHeading']))
        story.append(Paragraph(
            "Todos os testes foram executados com sucesso. O sistema demonstra funcionalidade completa e confiável "
            "em todos os cenários testados. As validações de segurança (autenticação, rotas protegidas) foram confirmadas. "
            "A importação de dados históricos funciona corretamente para os três formatos suportados.",
            self.styles['CustomBody']
        ))
        
        # Rodapé
        story.append(Spacer(1, 0.5*inch))
        story.append(Paragraph(f"Data: 2026-07-21 | Duração total dos testes: ~30 minutos", self.styles['Normal']))
        
        doc.build(story)
        return pdf_file

    def generate_pdf_3_arquitetura(self):
        """PDF 3: Arquitetura Técnica"""
        pdf_file = self.output_dir / "03_Arquitetura_Tecnica_TRL4.pdf"
        doc = SimpleDocTemplate(str(pdf_file), pagesize=A4, topMargin=0.5*inch, bottomMargin=0.5*inch)
        
        story = []
        
        # Capa
        story.append(Spacer(1, 1.2*inch))
        story.append(Paragraph("ARQUITETURA TÉCNICA", self.styles['CustomTitle']))
        story.append(Paragraph("Plataforma Preditiva de Inteligência Ambiental", self.styles['Heading3']))
        story.append(Spacer(1, 0.5*inch))
        story.append(Paragraph("TRL 4 — Junho/Julho de 2026", self.styles['CustomBody']))
        story.append(PageBreak())
        
        story.append(Paragraph("VISÃO GERAL", self.styles['CustomHeading']))
        story.append(Paragraph(
            "A plataforma é construída em arquitetura em camadas com separação clara entre interface do usuário, "
            "lógica de negócio, processamento de dados e persistência.",
            self.styles['CustomBody']
        ))
        story.append(Spacer(1, 0.2*inch))
        
        story.append(Paragraph("FLUXO PRINCIPAL DE ANÁLISE", self.styles['CustomHeading']))
        story.append(Paragraph(
            "1. Usuário insere dados ambientais (temperatura, umidade, vento, etc.) via formulário React<br/>"
            "2. Frontend valida entrada e envia para Express API<br/>"
            "3. Express valida novamente e encaminha para Python/FastAPI<br/>"
            "4. Python executa análise usando motor de regras ou modelo ML<br/>"
            "5. Resultado retorna com score, fatores e recomendações<br/>"
            "6. Frontend exibe resultado com visualizações",
            self.styles['CustomBody']
        ))
        story.append(Spacer(1, 0.3*inch))
        
        story.append(Paragraph("FLUXO DE IMPORTAÇÃO DE DADOS", self.styles['CustomHeading']))
        story.append(Paragraph(
            "1. Usuário faz upload de CSV, XLSX ou XLS<br/>"
            "2. Frontend parseia arquivo (csv library ou xlsx)<br/>"
            "3. Dados são validados linha por linha<br/>"
            "4. Usuário mapeia colunas do arquivo para campos do sistema<br/>"
            "5. Validação final e preview de dados<br/>"
            "6. Lote é salvo em import_batches<br/>"
            "7. Registros válidos são salvos em fire_occurrences<br/>"
            "8. Dados aparecem no mapa e relatórios",
            self.styles['CustomBody']
        ))
        story.append(PageBreak())
        
        story.append(Paragraph("STACK TECNOLÓGICO", self.styles['CustomHeading']))
        
        tech_data = [
            ['Camada', 'Tecnologia', 'Versão', 'Propósito'],
            ['Frontend', 'React', '18.3', 'Interface reativa do usuário'],
            ['Build Frontend', 'Vite', '7.3', 'Bundler e dev server rápido'],
            ['Estilização', 'Tailwind CSS', '3.4', 'Estilos utilitários responsivos'],
            ['Backend API', 'Express.js', '4.21', 'Servidor HTTP e rotas'],
            ['Linguagem Backend', 'TypeScript', '5.6', 'Tipagem estática para confiabilidade'],
            ['Motor de Análise', 'Python', '3.12', 'Processamento de dados e ML'],
            ['Framework Python', 'FastAPI', '0.115', 'API HTTP para Python'],
            ['ML/Análise', 'Scikit-learn', '1.9', 'Modelo RandomForest supervisionado'],
            ['ORM Backend', 'Drizzle ORM', '0.39', 'Gerenciamento de banco de dados'],
            ['Banco de Dados', 'PostgreSQL', '16', 'Persistência de dados'],
            ['Mapeamento', 'Leaflet.js', '1.9', 'Visualização geográfica interativa'],
            ['Autenticação', 'bcrypt', '6.0', 'Hashing seguro de senhas'],
            ['Sessões', 'express-session', '1.18', 'Gerenciamento de sessão do usuário'],
        ]
        
        t = Table(tech_data, colWidths=[1*inch, 1.4*inch, 1*inch, 1.6*inch])
        t.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#2e75b6')),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
            ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, 0), 8),
            ('BOTTOMPADDING', (0, 0), (-1, 0), 10),
            ('BACKGROUND', (0, 1), (-1, -1), colors.lightgrey),
            ('GRID', (0, 0), (-1, -1), 1, colors.black),
            ('FONTSIZE', (0, 1), (-1, -1), 7),
        ]))
        story.append(t)
        story.append(Spacer(1, 0.3*inch))
        
        story.append(Paragraph("ESTRUTURA DE DADOS", self.styles['CustomHeading']))
        
        db_data = [
            ['Tabela', 'Propósito', 'Campos Principais'],
            ['users', 'Autenticação', 'id, email, password_hash, created_at'],
            ['risk_analyses', 'Histórico de análises', 'id, user_id, score, level, created_at'],
            ['import_batches', 'Lotes de importação', 'id, filename, status, valid_rows, invalid_rows'],
            ['fire_occurrences', 'Ocorrências importadas', 'id, batch_id, latitude, longitude, occurrence_date'],
            ['monitored_areas', 'Áreas geográficas', 'id, name, latitude, longitude, is_active'],
        ]
        
        t2 = Table(db_data, colWidths=[1.5*inch, 2*inch, 2.5*inch])
        t2.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#2e75b6')),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
            ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, 0), 9),
            ('BOTTOMPADDING', (0, 0), (-1, 0), 10),
            ('BACKGROUND', (0, 1), (-1, -1), colors.lightgrey),
            ('GRID', (0, 0), (-1, -1), 1, colors.black),
            ('FONTSIZE', (0, 1), (-1, -1), 8),
        ]))
        story.append(t2)
        story.append(Spacer(1, 0.3*inch))
        
        story.append(Paragraph("SEGURANÇA", self.styles['CustomHeading']))
        story.append(Paragraph(
            "• Autenticação: Bcrypt com salt aleatório<br/>"
            "• Sessões: Session IDs seguros com express-session<br/>"
            "• Rotas Protegidas: HTTP 401 retornado para usuários não autenticados<br/>"
            "• Variáveis de Ambiente: DATABASE_URL e DIRECT_URL armazenadas em secrets, não em código<br/>"
            "• Validação de Entrada: TypeScript em frontend e validação de schema no backend",
            self.styles['CustomBody']
        ))
        story.append(Spacer(1, 0.3*inch))
        
        story.append(Paragraph("ESCALABILIDADE", self.styles['CustomHeading']))
        story.append(Paragraph(
            "• Frontend: Build estático servido via CDN<br/>"
            "• Backend: Stateless Express server (pode escalar horizontalmente)<br/>"
            "• Database: Connection pooling via Drizzle ORM<br/>"
            "• Python: FastAPI com workers uvicorn",
            self.styles['CustomBody']
        ))
        
        # Rodapé
        story.append(Spacer(1, 0.5*inch))
        story.append(Paragraph(f"Arquitetura documentada em 2026-07-21", self.styles['Normal']))
        
        doc.build(story)
        return pdf_file

    def generate_pdf_4_evidencias_visuais(self):
        """PDF 4: Evidências Visuais (roteiro)"""
        pdf_file = self.output_dir / "04_Evidencias_Visuais_do_Prototipo.pdf"
        doc = SimpleDocTemplate(str(pdf_file), pagesize=A4, topMargin=0.5*inch, bottomMargin=0.5*inch)
        
        story = []
        
        # Capa
        story.append(Spacer(1, 1.2*inch))
        story.append(Paragraph("EVIDÊNCIAS VISUAIS", self.styles['CustomTitle']))
        story.append(Paragraph("Capturas de Tela do Protótipo", self.styles['Heading3']))
        story.append(Spacer(1, 0.5*inch))
        story.append(Paragraph("Roteiro de Capturas Recomendadas", self.styles['CustomBody']))
        story.append(PageBreak())
        
        story.append(Paragraph("ROTEIRO DE CAPTURAS", self.styles['CustomHeading']))
        
        captures = [
            ("1. Página Inicial", "Hero section com título, descrição e call-to-action"),
            ("2. Dashboard Principal", "Visão geral com widgets de estatísticas e áreas monitoradas"),
            ("3. Análise de Risco - Cenário Baixo", "Formulário preenchido + resultado (score 17, nível baixo)"),
            ("4. Análise de Risco - Cenário Moderado", "Formulário preenchido + resultado (score 39, nível moderado)"),
            ("5. Análise de Risco - Cenário Alto", "Formulário preenchido + resultado (score 62, nível alto)"),
            ("6. Análise de Risco - Cenário Crítico", "Formulário preenchido + resultado (score 82, nível crítico)"),
            ("7. Fatores Explicativos", "Card de fatores com contribuição de cada fator"),
            ("8. Recomendações", "Lista de ações recomendadas com prioridade (urgente, preventiva, monitoramento)"),
            ("9. Mapa de Risco", "Mapa Leaflet com marcadores de áreas monitoradas e ocorrências"),
            ("10. Importação de CSV", "Tela /data-import com drag & drop e preview de arquivo"),
            ("11. Mapeamento de Colunas", "Interface de mapping entre colunas do arquivo e campos do sistema"),
            ("12. Validação de Dados", "Tabela com status de cada registro (válido, inválido, duplicado)"),
            ("13. Importação XLSX", "Upload de arquivo XLSX com visualização de dados"),
            ("14. Importação XLS", "Upload de arquivo XLS com visualização de dados"),
            ("15. Relatório de Importação", "Resumo do lote: total, válidos, inválidos, salvos"),
            ("16. Ocorrências no Mapa", "Mapa atualizado com ocorrências importadas"),
            ("17. Relatórios", "Tela /reports com gráficos e dados históricos"),
            ("18. Alertas", "Tela /alerts com notificações de eventos críticos"),
            ("19. Tutorial de Onboarding", "Modal inicial com passos de uso"),
            ("20. Modo Anônimo", "Header neutro sem identificação pessoal/institucional"),
        ]
        
        for num, (title, desc) in enumerate(captures, 1):
            story.append(Paragraph(f"<b>{title}</b>: {desc}", self.styles['CustomBody']))
            story.append(Spacer(1, 0.05*inch))
        
        story.append(PageBreak())
        story.append(Paragraph("PONTOS DE ATENÇÃO NAS CAPTURAS", self.styles['CustomHeading']))
        
        story.append(Paragraph(
            "• <b>Não incluir:</b> Senhas, tokens, URLs de banco, e-mails pessoais, nomes de usuários reais<br/>"
            "• <b>Modo anônimo:</b> Todas as capturas devem ser com VITE_SUBMISSION_MODE=true<br/>"
            "• <b>Resolução:</b> Usar resolução que mostre bem o conteúdo (1280x720 ou superior)<br/>"
            "• <b>Clareza:</b> Certificar-se de que o texto é legível e os elementos visuais são distinguíveis<br/>"
            "• <b>Completude:</b> Capturar fluxo completo de cada funcionalidade",
            self.styles['CustomBody']
        ))
        
        # Rodapé
        story.append(Spacer(1, 0.5*inch))
        story.append(Paragraph(f"Roteiro de capturas em 2026-07-21", self.styles['Normal']))
        
        doc.build(story)
        return pdf_file

    def generate_pdf_5_metricas_modelo(self):
        """PDF 5: Métricas do Modelo"""
        pdf_file = self.output_dir / "05_Metricas_do_Modelo_TRL4.pdf"
        doc = SimpleDocTemplate(str(pdf_file), pagesize=A4, topMargin=0.5*inch, bottomMargin=0.5*inch)
        
        story = []
        
        # Capa
        story.append(Spacer(1, 1.2*inch))
        story.append(Paragraph("MÉTRICAS DO MODELO", self.styles['CustomTitle']))
        story.append(Paragraph("Machine Learning Supervisionado — TRL 4", self.styles['Heading3']))
        story.append(Spacer(1, 0.5*inch))
        story.append(Paragraph("Scikit-learn RandomForestClassifier", self.styles['CustomBody']))
        story.append(PageBreak())
        
        story.append(Paragraph("⚠️ AVISO CRÍTICO", self.styles['CustomHeading']))
        story.append(Paragraph(
            "As métricas apresentadas neste documento foram obtidas com dataset SINTÉTICO em ambiente CONTROLADO. "
            "<b>O modelo NÃO foi validado com incêndios reais.</b> As métricas de 100% de acurácia indicam que o modelo "
            "reproduziu perfeitamente o motor de regras, não que está pronto para predições reais. A validação operacional "
            "com dados reais é prevista para a Prova de Valor.",
            self.styles['CustomBody']
        ))
        story.append(Spacer(1, 0.3*inch))
        
        story.append(Paragraph("PROPRIEDADES DO MODELO", self.styles['CustomHeading']))
        
        model_data = [
            ['Propriedade', 'Valor'],
            ['Algoritmo', 'RandomForestClassifier (Scikit-learn 1.9.0)'],
            ['Dataset', 'Sintético — gerado pelo motor de regras'],
            ['Total de Amostras', '2.000 (500 por classe)'],
            ['Divisão Treino/Teste', '80% / 20% (1.600 / 400)'],
            ['Classes', 'baixo, moderado, alto, crítico'],
            ['Features', '9 variáveis ambientais e históricas'],
            ['Estratégia Treino', 'Stratified k-fold'],
            ['Random State', '42 (determinístico)'],
            ['N Estimadores', '100 árvores de decisão'],
        ]
        
        t = Table(model_data, colWidths=[2.5*inch, 3.5*inch])
        t.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#2e75b6')),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
            ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, 0), 9),
            ('BOTTOMPADDING', (0, 0), (-1, 0), 12),
            ('BACKGROUND', (0, 1), (-1, -1), colors.lightgrey),
            ('GRID', (0, 0), (-1, -1), 1, colors.black),
            ('FONTSIZE', (0, 1), (-1, -1), 9),
        ]))
        story.append(t)
        story.append(Spacer(1, 0.3*inch))
        
        story.append(Paragraph("MÉTRICAS DE DESEMPENHO", self.styles['CustomHeading']))
        
        metrics_data = [
            ['Métrica', 'Valor'],
            ['Accuracy (Acurácia Global)', '84.25%'],
            ['Precision (macro)', '85.40%'],
            ['Recall (macro)', '90.74%'],
            ['F1-score (macro)', '87.29%'],
            ['Precision (weighted)', '85.57%'],
            ['Recall (weighted)', '84.25%'],
            ['F1-score (weighted)', '84.37%'],
        ]
        
        t2 = Table(metrics_data, colWidths=[2.5*inch, 3.5*inch])
        t2.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#2e75b6')),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
            ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, 0), 9),
            ('BOTTOMPADDING', (0, 0), (-1, 0), 12),
            ('BACKGROUND', (0, 1), (-1, -1), colors.lightgrey),
            ('GRID', (0, 0), (-1, -1), 1, colors.black),
            ('FONTSIZE', (0, 1), (-1, -1), 9),
        ]))
        story.append(t2)
        story.append(Spacer(1, 0.3*inch))
        
        story.append(Paragraph("MATRIZ DE CONFUSÃO", self.styles['CustomHeading']))
        
        confusion_data = [
            ['Predito ↓ / Real →', 'Baixo', 'Moderado', 'Alto', 'Crítico'],
            ['Baixo', '129', '16', '0', '0'],
            ['Moderado', '22', '162', '23', '0'],
            ['Alto', '0', '2', '45', '0'],
            ['Crítico', '0', '0', '0', '1'],
        ]
        
        t3 = Table(confusion_data, colWidths=[1.4*inch, 1.4*inch, 1.4*inch, 1.2*inch, 1.2*inch])
        t3.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#2e75b6')),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
            ('BACKGROUND', (0, 0), (0, -1), colors.HexColor('#2e75b6')),
            ('TEXTCOLOR', (0, 1), (0, -1), colors.whitesmoke),
            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, 0), 9),
            ('BOTTOMPADDING', (0, 0), (-1, 0), 12),
            ('BACKGROUND', (1, 1), (-1, -1), colors.lightgrey),
            ('GRID', (0, 0), (-1, -1), 1, colors.black),
            ('FONTSIZE', (0, 1), (-1, -1), 9),
        ]))
        story.append(t3)
        story.append(Spacer(1, 0.3*inch))
        
        story.append(Paragraph("LIMITAÇÕES", self.styles['CustomHeading']))
        story.append(Paragraph(
            "1. <b>Dataset Sintético:</b> Gerado pelo motor de regras, não por incêndios reais<br/>"
            "2. <b>Overfitting Possível:</b> O modelo aprendeu os padrões do gerador, não dados reais<br/>"
            "3. <b>Classe 'Crítico' Desbalanceada:</b> Apenas 1 amostra no conjunto de teste<br/>"
            "4. <b>Sem Validação Cruzada Rigorosa:</b> Nesta fase TRL 4<br/>"
            "5. <b>Distribuição Desconhecida:</b> Dados reais podem ter distribuição muito diferente",
            self.styles['CustomBody']
        ))
        story.append(Spacer(1, 0.3*inch))
        
        story.append(Paragraph("CONCLUSÃO", self.styles['CustomHeading']))
        story.append(Paragraph(
            "O modelo foi treinado e avaliado com dados sintéticos cujos rótulos foram derivados do motor transparente "
            "baseado em regras. O resultado de 84%+ de acurácia demonstra que o pipeline supervisionado é funcional, "
            "mas <b>não comprova capacidade preditiva em incêndios reais</b>. A calibração e a validação com dados reais "
            "estão previstas para a Prova de Valor.",
            self.styles['CustomBody']
        ))
        
        # Rodapé
        story.append(Spacer(1, 0.5*inch))
        story.append(Paragraph(f"Métricas geradas em 2026-07-21 | Scikit-learn 1.9.0 | Python 3.12.1", self.styles['Normal']))
        
        doc.build(story)
        return pdf_file

    def generate_all(self):
        """Gerar todos os 5 PDFs"""
        print("\n" + "="*70)
        print("GERADOR DE PDFs — EVIDÊNCIAS TRL 4")
        print("="*70 + "\n")
        
        try:
            pdf1 = self.generate_pdf_1_maturidade()
            print(f"✓ PDF 1 gerado: {pdf1.name}")
            
            pdf2 = self.generate_pdf_2_relatorio()
            print(f"✓ PDF 2 gerado: {pdf2.name}")
            
            pdf3 = self.generate_pdf_3_arquitetura()
            print(f"✓ PDF 3 gerado: {pdf3.name}")
            
            pdf4 = self.generate_pdf_4_evidencias_visuais()
            print(f"✓ PDF 4 gerado: {pdf4.name}")
            
            pdf5 = self.generate_pdf_5_metricas_modelo()
            print(f"✓ PDF 5 gerado: {pdf5.name}")
            
            print("\n" + "="*70)
            print("RESUMO DOS PDFs GERADOS")
            print("="*70)
            
            for pdf_file in self.output_dir.glob("*.pdf"):
                size_mb = pdf_file.stat().st_size / (1024 * 1024)
                print(f"{pdf_file.name:<50} {size_mb:>6.2f} MB")
            
            print("\n" + "="*70)
            print("Status: ✅ TODOS OS PDFs GERADOS COM SUCESSO")
            print("="*70 + "\n")
            
        except Exception as e:
            print(f"❌ Erro ao gerar PDFs: {e}")
            import traceback
            traceback.print_exc()

if __name__ == "__main__":
    generator = PDFGenerator()
    generator.generate_all()
