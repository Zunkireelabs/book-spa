import React from 'react';
import { PanelShell } from '../../../../components/ui/PanelFormKit';
import ProductCategories from './ProductCategories';

// "Product categories" opened on its own (from the Products header). Inside the product form it is a stacked view instead.
const ProductCategoriesPanel = ({ onClose, onCategoriesChanged }) => (
  <PanelShell variant="panel" title="Product categories" onClose={onClose} hideFooter>
    <ProductCategories onCategoriesChanged={onCategoriesChanged} />
  </PanelShell>
);

export default ProductCategoriesPanel;
