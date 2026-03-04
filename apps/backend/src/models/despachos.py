"""SQLAlchemy models for despachos, facturas and related resources."""

from __future__ import annotations

from sqlalchemy import PrimaryKeyConstraint, func
from sqlalchemy.orm import relationship

from ..extensions import db


class DespachoResumen(db.Model):
    __tablename__ = "APP_Despachos_Resumen"
    __table_args__ = {"schema": "dbo"}

    ID = db.Column("ID", db.Integer, primary_key=True)
    Despacho = db.Column("Despacho", db.String(50))
    Fecha = db.Column("Fecha", db.Date)
    OC_ID = db.Column("OC_ID", db.String(50), nullable=True)
    TipoDespacho = db.Column("TipoDespacho", db.String(10), nullable=True)
    Referencia = db.Column("Referencia", db.String(200), nullable=True)
    FOB = db.Column("FOB", db.Float)
    Flete_Internacional = db.Column("Flete_Internacional", db.Float)
    Estadistica = db.Column("Estadistica", db.Float)
    Derechos_Importacion = db.Column("Derechos_Importacion", db.Float)
    Despachante = db.Column("Despachante", db.Float)
    Almacenaje = db.Column("Almacenaje", db.Float)
    Custodia = db.Column("Custodia", db.Float)
    Tipo_Cambio = db.Column("Tipo_Cambio", db.Float)
    Flete_Nacional = db.Column("Flete_Nacional", db.Float)
    Arancel = db.Column("Arancel", db.Float)
    DocUrl = db.Column("DocUrl", db.String(500), nullable=True)
    DocName = db.Column("DocName", db.String(255), nullable=True)
    HasDoc = db.Column("HasDoc", db.Boolean, default=False, nullable=False)
    ocs = relationship (
        "DespachoOC",
        backref="despacho",
        cascade="all, delete-orphan",
        lazy="selectin",
        )

class DespachoOC(db.Model):
    __tablename__ = "Despacho_OC"
    __table_args__ = {"schema": "dbo"}

    id = db.Column("ID", db.Integer, primary_key=True)
    despacho_id = db.Column(
        "Despacho_ID",
        db.Integer,
        db.ForeignKey("dbo.APP_Despachos_Resumen.ID"),
        nullable=False,
    )
    oc_id = db.Column("OC_ID", db.String(50), nullable=False)
    referencia = db.Column("Referencia", db.String(200), nullable=True)
    created_at = db.Column("CreatedAt", db.DateTime, server_default=func.sysdatetime())


class TipoGasto(db.Model):
    __tablename__ = "TipoGastosBI"
    __table_args__ = {"schema": "dbo"}

    IdGasto = db.Column("IdGasto", db.Integer, primary_key=True)
    TipoGasto = db.Column("TipoGasto", db.String(50))


class Factura(db.Model):
    __tablename__ = "APP_Despachos_Detalles"
    __table_args__ = {"schema": "dbo"}

    ID = db.Column("ID", db.Integer, primary_key=True)
    Fecha = db.Column("Fecha", db.Date, nullable=True)
    Invoice = db.Column("Invoice", db.String(50), nullable=True)
    nroFactura = db.Column("nroFactura", db.String(50), nullable=True)
    OrdenPO = db.Column("OrdenPO", db.String(50), nullable=True)
    Importe = db.Column("Importe", db.Float, nullable=True)
    SIMI_SIRA = db.Column("SIMI_SIRA", db.String(25), nullable=True)
    Descripcion = db.Column("Descripcion", db.String(100), nullable=True)
    Despacho = db.Column("Despacho", db.String(50), nullable=True)
    BL = db.Column("BL", db.String(50), nullable=True)
    Mercaderia = db.Column("Mercaderia", db.String(50), nullable=True)
    TipoGasto = db.Column("TipoGasto", db.Integer, nullable=True)
    Proveedor = db.Column("Proveedor", db.String(100), nullable=True)
    nroProveedor = db.Column("nroProveedor", db.String(50), nullable=True)
    Moneda = db.Column("Moneda", db.String(3), nullable=True)
    DocUrl = db.Column("DocUrl", db.String(500), nullable=True)
    DocName = db.Column("DocName", db.String(255), nullable=True)
    HasDoc = db.Column("HasDoc", db.Boolean, default=False, nullable=False)


class ResumenGasto(db.Model):
    __tablename__ = "App_Despachos_ResumenGasto"
    __table_args__ = {"schema": "dbo"}

    NroDespacho = db.Column("NroDespacho", db.String(50), primary_key=True)
    TipoGastoId = db.Column("TipoGastoId", db.Integer, primary_key=True)
    Total = db.Column("Total", db.Numeric(18, 2), nullable=False)


class FacturaDespacho(db.Model):
    __tablename__ = "Factura_Despacho"
    __table_args__ = (db.UniqueConstraint("factura_id", "despacho_id", name="UQ_Factura_Despacho_pair"), {"schema": "dbo"})

    id = db.Column("id", db.Integer, primary_key=True)
    factura_id = db.Column("factura_id", db.Integer, db.ForeignKey("dbo.APP_Despachos_Detalles.ID"), nullable=False)
    despacho_id = db.Column("despacho_id", db.Integer, db.ForeignKey("dbo.APP_Despachos_Resumen.ID"), nullable=False)
    created_at = db.Column("created_at", db.DateTime, server_default=func.sysdatetime())
    created_by = db.Column("created_by", db.String(128))


class ZFGrupo(db.Model):
    __tablename__ = "ZF_Grupo"
    __table_args__ = {"schema": "dbo"}

    ZF_GroupID = db.Column("ZF_GroupID", db.Integer, primary_key=True)
    OC_ID = db.Column("OC_ID", db.String(50), nullable=False)
    ZFI_ID = db.Column("ZFI_ID", db.Integer, nullable=False)
    CreatedAt = db.Column("CreatedAt", db.DateTime, server_default=func.sysdatetime())
    CreatedBy = db.Column("CreatedBy", db.String(128), nullable=True)


class ZFVinculo(db.Model):
    __tablename__ = "ZF_Vinculos"
    __table_args__ = (PrimaryKeyConstraint("ZF_GroupID", "ZFE_ID", name="PK_ZF_Vinculos"), {"schema": "dbo"})

    ZF_GroupID = db.Column("ZF_GroupID", db.Integer, nullable=False)
    ZFE_ID = db.Column("ZFE_ID", db.Integer, nullable=False)
    CreatedAt = db.Column("CreatedAt", db.DateTime, server_default=func.sysdatetime())
    CreatedBy = db.Column("CreatedBy", db.String(128), nullable=True)
